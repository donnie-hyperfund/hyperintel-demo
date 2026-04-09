/**
 * Dump all Langfuse prompts to zlocal/dump/, retaining folder structure from prompt names.
 *
 * Usage:
 *   pnpm dump:prompts              # development label (default)
 *   pnpm dump:prompts -- --prod    # production label
 */
import 'dotenv/config';
import { Langfuse } from 'langfuse';
import path from 'node:path';
import fs from 'node:fs';

const label = process.argv.includes('--prod') ? 'production' : 'development';
const DUMP_DIR = path.resolve(process.cwd(), 'zlocal', 'dump');

const { LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_HOST } = process.env;
if (!LANGFUSE_SECRET_KEY || !LANGFUSE_PUBLIC_KEY || !LANGFUSE_HOST) {
	console.error('Missing LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, or LANGFUSE_HOST in env.');
	console.error('Run via: pnpm env:dev dump:prompts');
	process.exit(1);
}

const client = new Langfuse({
	secretKey: LANGFUSE_SECRET_KEY,
	publicKey: LANGFUSE_PUBLIC_KEY,
	baseUrl: LANGFUSE_HOST,
});

async function listAllPrompts() {
	const all: { name: string; labels: string[] }[] = [];
	let page = 1;
	while (true) {
		const res = await client.api.promptsList({ page, limit: 100, label });
		all.push(...res.data);
		if (all.length >= res.meta.totalItems) break;
		page++;
	}
	return all;
}

function promptToFile(name: string): string {
	// pma/system-prompt → pma/system-prompt.md
	// chat-base-prompt → chat-base-prompt.md
	return path.join(DUMP_DIR, ...name.split('/')) + '.md';
}

async function main() {
	console.log(`Fetching prompts with label: ${label}`);

	const prompts = await listAllPrompts();
	console.log(`Found ${prompts.length} prompts`);

	if (prompts.length === 0) {
		console.log('No prompts found. Check label and credentials.');
		return;
	}

	// Clean dump dir
	if (fs.existsSync(DUMP_DIR)) {
		fs.rmSync(DUMP_DIR, { recursive: true });
	}

	let saved = 0;
	let skipped = 0;

	for (const meta of prompts) {
		try {
			const prompt = await client.getPrompt(meta.name, undefined, {
				label,
				cacheTtlSeconds: 0,
			});
			const filePath = promptToFile(meta.name);
			const dir = path.dirname(filePath);
			fs.mkdirSync(dir, { recursive: true });

			// TextPromptClient has .prompt as string, ChatPromptClient has .prompt as array
			const rawPrompt = (prompt as any).prompt;
			const content: string = typeof rawPrompt === 'string'
				? rawPrompt
				: JSON.stringify(rawPrompt, null, 2);

			fs.writeFileSync(filePath, content, 'utf-8');
			console.log(`  ${meta.name} (v${prompt.version}) → ${path.relative(process.cwd(), filePath)}`);
			saved++;
		} catch (err: any) {
			console.warn(`  SKIP ${meta.name}: ${err.message ?? err}`);
			skipped++;
		}
	}

	console.log(`\nDone. ${saved} saved, ${skipped} skipped → ${path.relative(process.cwd(), DUMP_DIR)}/`);
	await client.shutdownAsync();
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
