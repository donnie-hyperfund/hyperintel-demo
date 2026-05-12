import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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
]);

const projects = [
    { name: 'root', configPath: path.join(repoRoot, 'tsconfig.json') },
    { name: 'local', configPath: path.join(repoRoot, 'tsconfig.local.json') },
    { name: 'workers', configPath: path.join(repoRoot, 'workers', 'tsconfig.json') },
    { name: 'worker-tests', configPath: path.join(repoRoot, 'workers', 'tsconfig.tests.json') },
    { name: 'tests', configPath: path.join(repoRoot, 'tests', 'tsconfig.json') },
];

function normalize(filePath) {
    return path.resolve(filePath).replaceAll(path.sep, '/').toLowerCase();
}

function relativeDisplay(filePath) {
    return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function isTypeScriptSource(filePath) {
    return ['.ts', '.tsx', '.mts', '.cts'].some((extension) => filePath.endsWith(extension));
}

function expectedProjectName(filePath) {
    const relativePath = relativeDisplay(filePath);

    if (
        relativePath === 'worker-env-types.d.ts' ||
        relativePath.startsWith('tools/') ||
        relativePath.startsWith('workers/extract-rust/.wrangler/') ||
        relativePath.startsWith('workers/extract-rust/tester/pkg/')
    ) {
        return null;
    }

    if (
        relativePath.startsWith('app/(local)/') ||
        relativePath.startsWith('lib/local/') ||
        relativePath === 'workers/extract-rust/tester/local-mock.ts' ||
        /^common\/common\/local.*\.tsx?$/.test(relativePath)
    ) {
        return 'local';
    }

    if (
        relativePath.startsWith('workers/') &&
        (relativePath.includes('/__tests__/') || relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx'))
    ) {
        return 'worker-tests';
    }

    if (relativePath.startsWith('workers/')) {
        return 'workers';
    }

    if (
        relativePath.startsWith('tests/') ||
        relativePath.endsWith('.test.ts') ||
        relativePath.endsWith('.test.tsx')
    ) {
        return 'tests';
    }

    return 'root';
}

async function collectTypeScriptSources(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (!ignoredDirectoryNames.has(entry.name)) {
                files.push(...(await collectTypeScriptSources(absolutePath)));
            }
            continue;
        }

        if (entry.isFile() && isTypeScriptSource(entry.name)) {
            files.push(absolutePath);
        }
    }

    return files;
}

function loadProjectFiles(project) {
    const configFile = ts.readConfigFile(project.configPath, ts.sys.readFile);

    if (configFile.error) {
        return {
            files: new Set(),
            errors: [configFile.error],
        };
    }

    const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(project.configPath),
        undefined,
        project.configPath,
    );

    return {
        files: new Set(parsed.fileNames.map(normalize)),
        errors: parsed.errors,
    };
}

function formatDiagnostics(diagnostics) {
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => repoRoot,
        getNewLine: () => '\n',
    });
}

const projectFiles = new Map();
const configErrors = [];

for (const project of projects) {
    const result = loadProjectFiles(project);
    projectFiles.set(project.name, result.files);

    if (result.errors.length > 0) {
        configErrors.push(...result.errors);
    }
}

if (configErrors.length > 0) {
    console.error(formatDiagnostics(configErrors));
    process.exit(1);
}

const sources = await collectTypeScriptSources(repoRoot);
const issues = [];

for (const source of sources) {
    const normalizedSource = normalize(source);
    const expectedProject = expectedProjectName(source);
    if (!expectedProject) {
        continue;
    }
    const coveredBy = projects
        .filter((project) => projectFiles.get(project.name)?.has(normalizedSource))
        .map((project) => project.name);

    if (!coveredBy.includes(expectedProject)) {
        issues.push({
            file: relativeDisplay(source),
            expectedProject,
            coveredBy,
        });
    }
}

if (issues.length === 0) {
    console.log(`tsconfig coverage ok: ${sources.length} TypeScript files are covered by their expected configs.`);
    process.exit(0);
}

console.error(`tsconfig coverage failed: ${issues.length} file(s) are not covered by their expected configs.`);
console.error('');

for (const issue of issues) {
    const coveredBy = issue.coveredBy.length > 0 ? issue.coveredBy.join(', ') : 'none';
    console.error(`  ${issue.file}`);
    console.error(`    expected: ${issue.expectedProject}`);
    console.error(`    covered by: ${coveredBy}`);
}

process.exit(1);
