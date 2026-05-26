import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../context';

export const DEFAULT_LOCAL_PROMPTS_PATH = 'zlocal/prompts';

/**
 * Parse LOCAL_PROMPT_LOCATION env var.
 * - undefined/empty → null (use Langfuse)
 * - "true" → true (use default local path)
 * - other string → that string (use as custom path)
 */
export function parseLocalPromptEnv(): true | string | null {
    const envValue = process?.env?.LOCAL_PROMPT_LOCATION;
    if (!envValue) return null;
    if (envValue === 'true') return true;
    return envValue;
}

/** Resolve the local prompt path from env, returning the actual directory string or null. */
export function resolveLocalPromptPath(override?: true | string | null): string | null {
    const setting = override ?? parseLocalPromptEnv();
    if (!setting) return null;
    return setting === true ? DEFAULT_LOCAL_PROMPTS_PATH : setting;
}

/** Convert Langfuse slug to local filename (strips folder prefix, adds .md) */
export function slugToLocalFile(slug: string): string {
    const basename = slug.includes('/') ? slug.split('/').pop()! : slug;
    return `${basename}.md`;
}

/**
 * Get prompt content - from local file if localPath provided, otherwise from Langfuse.
 */
export async function getPromptContent(ctx: Ctx, slug: string, localPath: string | null): Promise<string | null> {
    if (localPath) {
        const filename = slugToLocalFile(slug);
        try {
            const filePath = path.join(process.cwd(), localPath, filename);
            return await fs.readFile(filePath, 'utf-8');
        } catch (err) {
            console.warn(`[getPromptContent] Failed to read local prompt: ${slug}`, err);
            return null;
        }
    }
    // Fallback to Langfuse
    try {
        const result = await ctx.env.LANGFUSE_PROMPT_SERVICE.getPromptRaw({ promptName: slug });
        return result.ok ? result.prompt : null;
    } catch {
        return null;
    }
}
