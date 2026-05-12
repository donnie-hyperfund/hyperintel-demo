import { chmod, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binDir = join(root, 'node_modules', '.bin');

if (process.env.GITHUB_ACTIONS === 'true' || process.env.VERCEL === '1' || process.env.VERCEL === 'true' || process.env.VERCEL_ENV) {
    console.log('Skipping local tsc shim patch in hosted install environment.');
    process.exit(0);
}

const notice = [
    '',
    'Do not use bare "tsc" in this repo.',
    '',
    'Use pnpm scripts instead:',
    '  pnpm run tsc:all     - app/root + workers + tests',
    '  pnpm run tsc:check   - root app config; excludes workers and tests',
    '  pnpm run tsc:workers - Cloudflare Workers config',
    '  pnpm run tsc:tests   - test config',
    '',
].join('\n');

const unixShim = `#!/usr/bin/env sh
cat <<'EOF'
${notice}EOF
exit 1
`;

const cmdShim = `@echo off
echo.
echo Do not use bare "tsc" in this repo.
echo.
echo Use pnpm scripts instead:
echo   pnpm run tsc:all     - app/root + workers + tests
echo   pnpm run tsc:check   - root app config; excludes workers and tests
echo   pnpm run tsc:workers - Cloudflare Workers config
echo   pnpm run tsc:tests   - test config
echo.
exit /b 1
`;

const psShim = `$ErrorActionPreference = "Stop"
Write-Host @'
${notice}'@
exit 1
`;

await mkdir(binDir, { recursive: true });

async function backupIfMissing(fileName) {
    const source = join(binDir, fileName);
    const backup = join(binDir, `${fileName}.bup`);

    try {
        await stat(backup);
        return;
    } catch {}

    try {
        await stat(source);
    } catch {
        return;
    }

    await copyFile(source, backup);
}

await backupIfMissing('tsc');
await writeFile(join(binDir, 'tsc'), unixShim);
await chmod(join(binDir, 'tsc'), 0o755);

await backupIfMissing('tsc.cmd');
await writeFile(join(binDir, 'tsc.cmd'), cmdShim);

await backupIfMissing('tsc.ps1');
await writeFile(join(binDir, 'tsc.ps1'), psShim);

console.log('Patched local node_modules/.bin/tsc shims to print repo TypeScript check policy.');
