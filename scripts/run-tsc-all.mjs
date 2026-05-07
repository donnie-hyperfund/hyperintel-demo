import { spawnSync } from 'node:child_process';

const commands = [
    ['pnpm', ['run', 'tsc:check']],
    ['pnpm', ['run', 'tsc:local']],
    ['pnpm', ['run', 'tsc:workers']],
    ['pnpm', ['run', 'tsc:worker-tests']],
    ['pnpm', ['run', 'tsc:tests']],
    ['pnpm', ['run', 'tsc:coverage']],
];

let failed = false;

for (const [command, args] of commands) {
    const label = [command, ...args].join(' ');
    console.log(`\n=== ${label} ===\n`);

    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    if (result.status !== 0) {
        failed = true;
        console.error(`\n${label} failed with exit code ${result.status ?? 'unknown'}\n`);
    }
}

process.exit(failed ? 1 : 0);
