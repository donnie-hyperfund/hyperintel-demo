import fs from 'node:fs';
import path from 'node:path';

const ERRORS_DIR = '_errors';

function findErrorDirs(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') continue;
		if (!entry.isDirectory()) continue;
		const full = path.join(dir, entry.name);
		if (entry.name === ERRORS_DIR && dir.endsWith('__tests__')) {
			results.push(full);
		} else {
			results.push(...findErrorDirs(full));
		}
	}
	return results;
}

const dirs = findErrorDirs(process.cwd());

if (dirs.length === 0) {
	console.log('No _errors directories found.');
	process.exit(0);
}

for (const dir of dirs) {
	const files = fs.readdirSync(dir);
	fs.rmSync(dir, { recursive: true });
	console.log(`Removed ${dir} (${files.length} file${files.length === 1 ? '' : 's'})`);
}
