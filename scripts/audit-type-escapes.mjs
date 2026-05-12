import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const failOnArg = args.find((arg) => arg.startsWith('--fail-on='));
const maxFindingsArg = args.find((arg) => arg.startsWith('--max-findings='));

const failOn = args.includes('--no-fail') ? 'none' : (failOnArg?.split('=')[1] ?? 'none');
const jsonOutput = args.includes('--json');
const verbose = args.includes('--verbose');
const maxFindings = verbose ? Number.POSITIVE_INFINITY : Number(maxFindingsArg?.split('=')[1] ?? 100);

const validFailModes = new Set(['none', 'error', 'warning']);
if (!validFailModes.has(failOn)) {
    console.error(`Invalid --fail-on value "${failOn}". Use one of: none, error, warning.`);
    process.exit(2);
}

if (!Number.isFinite(maxFindings) && !verbose) {
    console.error('Invalid --max-findings value. Use a number, or pass --verbose for the full report.');
    process.exit(2);
}

const ignoredDirectoryNames = new Set([
    '.git',
    '.next',
    '.turbo',
    '.wrangler',
    '.claude',
    '.codex',
    'coverage',
    'dist',
    'build',
    'out',
    'node_modules',
    'tools',
]);

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);

const checkMetadata = {
    'ts-nocheck': {
        label: '@ts-nocheck',
        defaultSeverity: 'error',
        missingReasonSeverity: 'error',
        note: 'Disables typechecking for the whole file.',
    },
    'ts-ignore': {
        label: '@ts-ignore',
        defaultSeverity: 'error',
        missingReasonSeverity: 'error',
        note: 'Hides the next-line TypeScript error even after it becomes obsolete.',
    },
    'ts-expect-error': {
        label: '@ts-expect-error',
        defaultSeverity: 'warning',
        missingReasonSeverity: 'error',
        note: 'Allowed for known compiler gaps, but should explain why.',
    },
    'as-any': {
        label: 'as any',
        defaultSeverity: 'error',
        testSeverity: 'warning',
        note: 'Erases the inferred value type.',
    },
    'as-unknown-as': {
        label: 'as unknown as',
        defaultSeverity: 'warning',
        testSeverity: 'warning',
        note: 'Double assertions bypass assignability checks.',
    },
    'type-any': {
        label: ': any',
        defaultSeverity: 'warning',
        testSeverity: 'warning',
        note: 'Explicit any should stay visible even where it is tolerated.',
    },
    'biome-ignore': {
        label: 'biome-ignore',
        defaultSeverity: 'warning',
        missingReasonSeverity: 'warning',
        note: 'Lint suppressions should have a short reason.',
    },
    'eslint-disable': {
        label: 'eslint-disable',
        defaultSeverity: 'warning',
        missingReasonSeverity: 'warning',
        note: 'Legacy lint suppressions should have a short reason.',
    },
};

const commentChecks = [
    { id: 'ts-nocheck', regex: /@ts-nocheck\b/g },
    { id: 'ts-ignore', regex: /@ts-ignore\b/g },
    { id: 'ts-expect-error', regex: /@ts-expect-error\b/g },
    { id: 'biome-ignore', regex: /biome-ignore\b/g },
    { id: 'eslint-disable', regex: /eslint-disable(?:-next-line|-line)?\b/g },
];

function normalizeDisplay(filePath) {
    return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function isSourceFile(filePath) {
    return sourceExtensions.has(path.extname(filePath));
}

function scriptKindFor(filePath) {
    switch (path.extname(filePath)) {
        case '.tsx':
            return ts.ScriptKind.TSX;
        case '.mts':
            return ts.ScriptKind.MTS;
        case '.cts':
            return ts.ScriptKind.CTS;
        default:
            return ts.ScriptKind.TS;
    }
}

function isTestFile(relativePath) {
    return (
        relativePath.startsWith('tests/') ||
        relativePath.includes('/__tests__/') ||
        /\.(test|spec)\.tsx?$/.test(relativePath)
    );
}

function getLineText(lines, lineNumber) {
    return lines[lineNumber - 1]?.trim() ?? '';
}

function hasCommentReason(commentText, id, matchEnd) {
    const afterDirective = commentText.slice(matchEnd).trim();

    if (id === 'biome-ignore') {
        return /:\s*\S/.test(afterDirective);
    }

    if (id === 'eslint-disable') {
        return /--\s*\S/.test(afterDirective);
    }

    return afterDirective.replace(/^[:\s-]+/, '').trim().length > 0;
}

function severityFor(id, relativePath, options = {}) {
    const metadata = checkMetadata[id];

    if (options.missingReason) {
        return metadata.missingReasonSeverity ?? metadata.defaultSeverity;
    }

    if (isTestFile(relativePath) && metadata.testSeverity) {
        return metadata.testSeverity;
    }

    return metadata.defaultSeverity;
}

function isAssertionExpression(node) {
    return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function isDirectAnyAssertionType(typeNode) {
    if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
        return true;
    }

    if (ts.isArrayTypeNode(typeNode)) {
        return isDirectAnyAssertionType(typeNode.elementType);
    }

    if (ts.isParenthesizedTypeNode(typeNode)) {
        return isDirectAnyAssertionType(typeNode.type);
    }

    return false;
}

function isInsideDirectAnyAssertionType(node) {
    let current = node.parent;

    while (current) {
        if (
            isAssertionExpression(current) &&
            isDirectAnyAssertionType(current.type) &&
            node.pos >= current.type.pos &&
            node.end <= current.type.end
        ) {
            return true;
        }

        current = current.parent;
    }

    return false;
}

function shouldFailWith(errorCount, warningCount) {
    if (failOn === 'warning') {
        return errorCount + warningCount > 0;
    }

    if (failOn === 'error') {
        return errorCount > 0;
    }

    return false;
}

async function collectSourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (!ignoredDirectoryNames.has(entry.name)) {
                files.push(...(await collectSourceFiles(absolutePath)));
            }
            continue;
        }

        if (entry.isFile() && isSourceFile(entry.name)) {
            files.push(absolutePath);
        }
    }

    return files;
}

function createFinding({ id, relativePath, sourceFile, lines, position, missingReason = false }) {
    const metadata = checkMetadata[id];
    const location = sourceFile.getLineAndCharacterOfPosition(position);
    const line = location.line + 1;

    return {
        file: relativePath,
        line,
        column: location.character + 1,
        severity: severityFor(id, relativePath, { missingReason }),
        id,
        label: metadata.label,
        note: metadata.note,
        source: getLineText(lines, line),
    };
}

function collectCommentFindings({ sourceFile, content, lines, relativePath }) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, content);
    const findings = [];

    while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
        const token = scanner.getToken();

        if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) {
            continue;
        }

        const commentText = scanner.getTokenText();
        const tokenStart = scanner.getTokenPos();

        for (const check of commentChecks) {
            check.regex.lastIndex = 0;
            let match;

            while ((match = check.regex.exec(commentText)) !== null) {
                const matchStart = tokenStart + match.index;
                const matchEnd = match.index + match[0].length;
                findings.push(
                    createFinding({
                        id: check.id,
                        relativePath,
                        sourceFile,
                        lines,
                        position: matchStart,
                        missingReason: !hasCommentReason(commentText, check.id, matchEnd),
                    }),
                );
            }
        }
    }

    return findings;
}

function collectTypeFindings({ sourceFile, lines, relativePath }) {
    const findings = [];
    const seen = new Set();

    function addFinding(id, node, positionNode = node) {
        const position = positionNode.getStart(sourceFile);
        const key = `${id}:${position}`;
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        findings.push(createFinding({ id, relativePath, sourceFile, lines, position }));
    }

    function visit(node) {
        if (isAssertionExpression(node)) {
            if (isDirectAnyAssertionType(node.type)) {
                addFinding('as-any', node, node.type);
            }

            if (
                isAssertionExpression(node.expression) &&
                node.expression.type.kind === ts.SyntaxKind.UnknownKeyword
            ) {
                addFinding('as-unknown-as', node.expression, node.expression.type);
            }
        }

        if (node.kind === ts.SyntaxKind.AnyKeyword && !isInsideDirectAnyAssertionType(node)) {
            addFinding('type-any', node);
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return findings;
}

const findings = [];
const files = await collectSourceFiles(repoRoot);

for (const file of files) {
    const relativePath = normalizeDisplay(file);
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKindFor(file));

    findings.push(...collectCommentFindings({ sourceFile, content, lines, relativePath }));
    findings.push(...collectTypeFindings({ sourceFile, lines, relativePath }));
}

findings.sort((left, right) => {
    if (left.severity !== right.severity) {
        return left.severity === 'error' ? -1 : 1;
    }

    return `${left.file}:${left.line}:${left.column}:${left.id}`.localeCompare(
        `${right.file}:${right.line}:${right.column}:${right.id}`,
    );
});

const errorCount = findings.filter((finding) => finding.severity === 'error').length;
const warningCount = findings.filter((finding) => finding.severity === 'warning').length;

if (jsonOutput) {
    console.log(
        JSON.stringify(
            {
                filesChecked: files.length,
                errors: errorCount,
                warnings: warningCount,
                findings,
            },
            null,
            2,
        ),
    );
} else if (findings.length === 0) {
    console.log(`type escape audit ok: ${files.length} TypeScript files checked.`);
} else {
    const countsById = new Map();
    for (const finding of findings) {
        const key = `${finding.severity}:${finding.id}`;
        countsById.set(key, (countsById.get(key) ?? 0) + 1);
    }

    console.log(
        `type escape audit found ${findings.length} finding(s): ${errorCount} error(s), ${warningCount} warning(s).`,
    );
    console.log(`files checked: ${files.length}`);
    console.log('');

    for (const severity of ['error', 'warning']) {
        const entries = [...countsById.entries()]
            .filter(([key]) => key.startsWith(`${severity}:`))
            .sort(([left], [right]) => left.localeCompare(right));

        if (entries.length === 0) {
            continue;
        }

        console.log(`${severity}s by kind:`);
        for (const [key, count] of entries) {
            console.log(`  ${key.split(':')[1]}: ${count}`);
        }
        console.log('');
    }

    const displayedFindings = findings.slice(0, maxFindings);
    for (const finding of displayedFindings) {
        console.log(`${finding.file}:${finding.line}:${finding.column} [${finding.severity}] ${finding.label}`);
        console.log(`  ${finding.source}`);
        console.log(`  ${finding.note}`);
    }

    if (displayedFindings.length < findings.length) {
        console.log('');
        console.log(
            `${findings.length - displayedFindings.length} more finding(s) hidden. Use --verbose, --json, or --max-findings=N.`,
        );
    }
}

process.exit(shouldFailWith(errorCount, warningCount) ? 1 : 0);
