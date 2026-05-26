import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const WRANGLER_BIN = require.resolve('wrangler/bin/wrangler.js');
const STORE_ID = 'b0b79b79a9e4400384c1e86239b96635';

const TARGETS = {
    dev: {
        envFile: '.env.dev',
        persistTo: '.wrangler/miniflare-dev',
        mappings: {
            DEV_HI_DATABASE_URL: 'DATABASE_URL_DIRECT',
            DEV_CLERK_SECRET_KEY: 'CLERK_SECRET_KEY',
            HI_ANTHROPIC_API_KEY_DEV: 'ANTHROPIC_API_KEY',
            DEV_OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
            OPENAI_KEY: 'OPENAI_API_KEY',
            HI_LANGFUSE_SECRET_KEY: 'LANGFUSE_SECRET_KEY',
            POSTHOG_KEY: { env: 'POSTHOG_KEY', default: '', deleteIfEmpty: true },
            QUEUE_AUTH_SECRET: 'AUTH_SECRET',
            FIRECRAWL_API_KEY: 'FIRECRAWL_API_KEY',
            R2_ACCESS_KEY_ID: 'R2_ACCESS_KEY_ID',
            R2_SECRET_ACCESS_KEY: 'R2_SECRET_ACCESS_KEY',
            CF_ACCOUNT_ID: 'CF_ACCOUNT_ID',
            REDUCTO_API_KEY: 'REDUCTO_API_KEY',
        },
    },
    prod: {
        envFile: '.env.prod',
        persistTo: '.wrangler/miniflare-prod',
        mappings: {
            HI_DATABASE_URL: 'DATABASE_URL_DIRECT',
            CLERK_SECRET_KEY: 'CLERK_SECRET_KEY',
            HI_ANTHROPIC_API_KEY_PROD: 'ANTHROPIC_API_KEY',
        },
    },
};

const args = process.argv.slice(2);
const targetName = args.find((arg) => !arg.startsWith('-'));
const dryRun = args.includes('--dry-run');

if (!targetName || !['dev', 'prod', 'all'].includes(targetName)) {
    console.error('Usage: node scripts/sync-miniflare-secrets.mjs <dev|prod|all> [--dry-run]');
    process.exit(1);
}

for (const name of targetName === 'all' ? ['dev', 'prod'] : [targetName]) {
    await syncTarget(name, TARGETS[name]);
}

async function syncTarget(name, target) {
    const envPath = resolve(target.envFile);
    const persistTo = resolve(target.persistTo);
    if (!existsSync(envPath)) {
        throw new Error(`[${name}] Env file not found: ${envPath}`);
    }
    const env = parseDotenv(readFileSync(envPath, 'utf8'));
    const values = resolveMappings(target.mappings, env, target.envFile);

    console.log(`[${name}] ${dryRun ? 'Would sync' : 'Syncing'} ${values.size} secrets from ${target.envFile}`);

    const existing = dryRun ? new Map() : await listLocalSecrets(persistTo);
    for (const [secretName, entry] of values) {
        const value = entry.value;
        const existingId = existing.get(secretName);
        if (entry.delete) {
            if (dryRun) {
                console.log(`[${name}] ${secretName}: delete if present`);
            } else if (existingId) {
                await runWrangler([
                    'secrets-store',
                    'secret',
                    'delete',
                    STORE_ID,
                    '--secret-id',
                    existingId,
                    '--persist-to',
                    persistTo,
                ]);
                console.log(`[${name}] deleted ${secretName}`);
            } else {
                console.log(`[${name}] skipped ${secretName} (empty)`);
            }
        } else if (dryRun) {
            console.log(`[${name}] ${secretName}: ${existingId ? 'update' : 'create/update'}`);
        } else if (existingId) {
            await runWrangler([
                'secrets-store',
                'secret',
                'update',
                STORE_ID,
                '--secret-id',
                existingId,
                '--value',
                value,
                '--scopes',
                'workers',
                '--persist-to',
                persistTo,
            ]);
            console.log(`[${name}] updated ${secretName}`);
        } else {
            await runWrangler([
                'secrets-store',
                'secret',
                'create',
                STORE_ID,
                '--name',
                secretName,
                '--value',
                value,
                '--scopes',
                'workers',
                '--persist-to',
                persistTo,
            ]);
            console.log(`[${name}] created ${secretName}`);
        }
    }
}

function resolveMappings(mappings, env, envFile) {
    const result = new Map();
    const missing = [];

    for (const [secretName, mapping] of Object.entries(mappings)) {
        const envName = typeof mapping === 'string' ? mapping : mapping.env;
        const hasDefault = typeof mapping === 'object' && Object.hasOwn(mapping, 'default');
        const value = env[envName] ?? (hasDefault ? mapping.default : undefined);

        if (value === undefined) {
            missing.push(`${secretName} <- ${envName}`);
        } else {
            if (value === '' && mapping.deleteIfEmpty) {
                result.set(secretName, { delete: true, value: '' });
            } else if (value === '') {
                missing.push(`${secretName} <- ${envName} (empty values are not accepted by Wrangler)`);
            } else {
                result.set(secretName, { delete: false, value });
            }
        }
    }

    if (missing.length > 0) {
        throw new Error(`Missing values in ${envFile}:\n${missing.map((item) => `  ${item}`).join('\n')}`);
    }

    return result;
}

async function listLocalSecrets(persistTo) {
    const result = await runWrangler(
        ['secrets-store', 'secret', 'list', STORE_ID, '--per-page', '100', '--persist-to', persistTo],
        { allowNoSecrets: true },
    );

    if (result.exitCode !== 0 && result.output.includes('List request returned no secrets')) {
        return new Map();
    }
    if (result.exitCode !== 0) {
        throw new Error(result.output);
    }

    const secrets = new Map();
    for (const line of result.output.split(/\r?\n/)) {
        const match = line.match(/^│\s*([^│]+?)\s*│\s*([a-f0-9]{32})\s*│/i);
        if (match && match[1] !== 'Name') {
            secrets.set(match[1].trim(), match[2]);
        }
    }
    return secrets;
}

function runWrangler(args, options = {}) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, [WRANGLER_BIN, ...args], {
            cwd: process.cwd(),
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (exitCode) => {
            const result = { exitCode, output };
            if (exitCode === 0 || options.allowNoSecrets) {
                resolvePromise(result);
            } else {
                reject(new Error(output));
            }
        });
    });
}

function parseDotenv(content) {
    const env = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const normalized = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;
        const equalsIndex = normalized.indexOf('=');
        if (equalsIndex === -1) continue;

        const key = normalized.slice(0, equalsIndex).trim();
        const rawValue = normalized.slice(equalsIndex + 1);
        if (!key) continue;

        env[key] = parseDotenvValue(rawValue);
    }
    return env;
}

function parseDotenvValue(rawValue) {
    let value = rawValue.trim();
    let quote = null;

    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if ((char === '"' || char === "'") && (i === 0 || value[i - 1] !== '\\')) {
            quote = quote === char ? null : quote ?? char;
        }
        if (char === '#' && quote === null && (i === 0 || /\s/.test(value[i - 1]))) {
            value = value.slice(0, i).trimEnd();
            break;
        }
    }

    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }

    return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}
