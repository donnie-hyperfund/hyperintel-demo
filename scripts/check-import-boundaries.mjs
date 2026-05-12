import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');

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

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function normalizePath(filePath) {
    return path.resolve(filePath).replaceAll(path.sep, '/');
}

function relativeDisplay(filePath) {
    return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function isSourceFile(filePath) {
    return sourceExtensions.has(path.extname(filePath));
}

function scriptKindFor(filePath) {
    switch (path.extname(filePath)) {
        case '.tsx':
            return ts.ScriptKind.TSX;
        case '.jsx':
            return ts.ScriptKind.JSX;
        case '.mts':
            return ts.ScriptKind.MTS;
        case '.cts':
            return ts.ScriptKind.CTS;
        case '.js':
        case '.mjs':
        case '.cjs':
            return ts.ScriptKind.JS;
        default:
            return ts.ScriptKind.TS;
    }
}

function isTestFile(relativePath) {
    return (
        relativePath.startsWith('tests/') ||
        relativePath.includes('/__tests__/') ||
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath)
    );
}

function isAllowedWorkerImporter(relativePath) {
    return (
        relativePath.startsWith('workers/') ||
        relativePath.startsWith('tests/') ||
        relativePath.startsWith('app/(local)/') ||
        relativePath.startsWith('lib/local/') ||
        /^common\/common\/local.*\.[cm]?[jt]sx?$/.test(relativePath) ||
        isTestFile(relativePath)
    );
}

function resolveImportSpecifier(specifier, importerFile) {
    if (specifier.startsWith('@/')) {
        return relativeDisplay(path.join(repoRoot, specifier.slice(2)));
    }

    if (specifier.startsWith('@worker/')) {
        return relativeDisplay(path.join(repoRoot, 'workers', '_common', specifier.slice('@worker/'.length)));
    }

    if (specifier === '@worker') {
        return 'workers/_common';
    }

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const importerDirectory = path.dirname(importerFile);
        const resolved = normalizePath(path.resolve(importerDirectory, specifier));
        const normalizedRoot = `${normalizePath(repoRoot)}/`;

        if (resolved.startsWith(normalizedRoot)) {
            return resolved.slice(normalizedRoot.length);
        }
    }

    return null;
}

function isForbiddenWorkerTarget(resolvedSpecifier) {
    if (!resolvedSpecifier.startsWith('workers/')) {
        return false;
    }

    if (resolvedSpecifier.startsWith('workers/_common/')) {
        return false;
    }

    return /\/src(?:\/|$)/.test(resolvedSpecifier);
}

function callExpressionName(node, sourceFile) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return 'import()';
    }

    if (ts.isIdentifier(node.expression)) {
        return node.expression.text;
    }

    if (ts.isPropertyAccessExpression(node.expression)) {
        return node.expression.getText(sourceFile);
    }

    return null;
}

function isImportLikeCall(node, sourceFile) {
    const name = callExpressionName(node, sourceFile);
    return name === 'import()' || name === 'require' || name === 'vi.mock' || name === 'jest.mock';
}

function importKindForNode(node, sourceFile) {
    if (ts.isImportDeclaration(node)) {
        return node.importClause?.isTypeOnly ? 'type import' : 'import';
    }

    if (ts.isExportDeclaration(node)) {
        return node.isTypeOnly ? 'type export' : 'export';
    }

    if (ts.isImportEqualsDeclaration(node)) {
        return node.isTypeOnly ? 'type import=' : 'import=';
    }

    if (ts.isCallExpression(node)) {
        return callExpressionName(node, sourceFile) ?? 'call';
    }

    return 'import';
}

function getLineSource(lines, lineNumber) {
    return lines[lineNumber - 1]?.trim() ?? '';
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

function collectImportSpecifiers(sourceFile) {
    const imports = [];

    function addImport(node, specifierNode) {
        if (!specifierNode || !ts.isStringLiteralLike(specifierNode)) {
            return;
        }

        imports.push({
            node,
            specifierNode,
            specifier: specifierNode.text,
        });
    }

    function visit(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            addImport(node, node.moduleSpecifier);
        } else if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference)
        ) {
            addImport(node, node.moduleReference.expression);
        } else if (ts.isCallExpression(node) && isImportLikeCall(node, sourceFile)) {
            addImport(node, node.arguments[0]);
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return imports;
}

const files = await collectSourceFiles(repoRoot);
const violations = [];

for (const file of files) {
    const relativePath = relativeDisplay(file);
    const content = await readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKindFor(file));
    const lines = content.split(/\r?\n/);
    const importerAllowed = isAllowedWorkerImporter(relativePath);

    for (const imported of collectImportSpecifiers(sourceFile)) {
        const resolvedSpecifier = resolveImportSpecifier(imported.specifier, file);

        if (!resolvedSpecifier || !isForbiddenWorkerTarget(resolvedSpecifier) || importerAllowed) {
            continue;
        }

        const location = sourceFile.getLineAndCharacterOfPosition(imported.specifierNode.getStart(sourceFile));
        const line = location.line + 1;

        violations.push({
            file: relativePath,
            line,
            column: location.character + 1,
            kind: importKindForNode(imported.node, sourceFile),
            specifier: imported.specifier,
            resolved: resolvedSpecifier,
            source: getLineSource(lines, line),
        });
    }
}

violations.sort((left, right) =>
    `${left.file}:${left.line}:${left.column}`.localeCompare(`${right.file}:${right.line}:${right.column}`),
);

if (jsonOutput) {
    console.log(
        JSON.stringify(
            {
                filesChecked: files.length,
                violations,
            },
            null,
            2,
        ),
    );
} else if (violations.length === 0) {
    console.log(`import boundaries ok: ${files.length} source files checked.`);
} else {
    console.error(
        `import boundaries failed: ${violations.length} disallowed worker runtime import(s) found.`,
    );
    console.error('');
    console.error('Only these importers may import workers/<name>/src/** directly:');
    console.error('  workers/**');
    console.error('  tests/** and *.test.*/*.spec.*');
    console.error('  app/(local)/**');
    console.error('  lib/local/**');
    console.error('  common/common/local*');
    console.error('');

    for (const violation of violations) {
        console.error(`${violation.file}:${violation.line}:${violation.column}`);
        console.error(`  ${violation.kind}: ${violation.specifier}`);
        console.error(`  resolved: ${violation.resolved}`);
        console.error(`  ${violation.source}`);
    }
}

process.exit(violations.length > 0 ? 1 : 0);
