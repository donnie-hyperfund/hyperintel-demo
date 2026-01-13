/**
 * Prompt Management Tools
 *
 * Generic tools for managing which prompts are loaded into agent context.
 * Returns a factory that creates tools configured with allowed slugs and aliases.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { z } from 'zod';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Config is either:
 * - Record<string, string>: alias -> slug mapping (slugs derived from values)
 * - string[]: just allowed slugs with no aliases
 */
export type PromptToolsConfig = Record<string, string> | string[];

/** Optional display names for slugs (slug -> friendly name) */
export type PromptDisplayNames = Record<string, string>;

/** Context must have loadedPrompts */
export interface PromptToolsContext {
    loadedPrompts: Set<string>;
}

// ============================================================================
// UTILITIES
// ============================================================================

function normalizeDocumentName(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function resolveSlug(input: string, config: PromptToolsConfig): string | null {
    const normalized = normalizeDocumentName(input);
    const isAliasMap = !Array.isArray(config);
    const allowedSlugs = isAliasMap ? [...new Set(Object.values(config))] : config;
    const aliases = isAliasMap ? config : null;

    // Check aliases first
    if (aliases?.[normalized]) {
        return aliases[normalized];
    }

    // Substring match on aliases
    if (aliases) {
        for (const [alias, slug] of Object.entries(aliases)) {
            if (alias.includes(normalized) || normalized.includes(alias)) {
                return slug;
            }
        }
    }

    // Direct match on allowed slugs
    const normalizedSlug = normalized.replace(/_/g, '-');
    if (allowedSlugs.includes(normalizedSlug)) {
        return normalizedSlug;
    }

    // Substring match on allowed slugs
    for (const slug of allowedSlugs) {
        const normalizedAllowed = normalizeDocumentName(slug);
        if (normalizedAllowed.includes(normalized) || normalized.includes(normalizedAllowed)) {
            return slug;
        }
    }

    return null;
}

// ============================================================================
// TOOL GROUP
// ============================================================================

export const PromptManagementToolGroup: AgentToolGroup = {
    name: 'Framework Document Management',
    slug: 'prompt_',
    description: 'Tools for managing which framework documents are loaded.',
    guidance: 'Load documents when you need specific protocols. Unload when done.',
    tools: ['load_prompt', 'unload_prompt', 'list_prompts'],
};

// ============================================================================
// FACTORY
// ============================================================================

export function createPromptTools(
    config: PromptToolsConfig,
    displayNames?: PromptDisplayNames,
    alwaysLoaded?: Set<string>,
) {
    const allowedSlugs = Array.isArray(config) ? config : [...new Set(Object.values(config))];

    // Format slug for display
    const formatSlug = (slug: string) => displayNames?.[slug] ?? slug;

    const LoadPromptParams = z.object({
        document_name: z.string().min(1).describe('Name or slug of the document to load.'),
    });

    const UnloadPromptParams = z.object({
        document_name: z.string().min(1).describe('Name or slug of the document to unload.'),
    });

    const ListPromptsParams = z.object({});

    return [
        {
            name: 'load_prompt' as const,
            description: 'Load a framework document into context.',
            parameters: LoadPromptParams,
            executor: (input: { document_name: string }, ctx: PromptToolsContext) => {
                const slug = resolveSlug(input.document_name, config);

                if (!slug) {
                    const available = allowedSlugs.map(formatSlug).join(', ');
                    return `Could not resolve "${input.document_name}". Available: ${available}`;
                }

                // Check if always loaded
                if (alwaysLoaded?.has(slug)) {
                    return `"${formatSlug(slug)}" is always loaded and cannot be modified.`;
                }

                if (ctx.loadedPrompts.has(slug)) {
                    return `"${formatSlug(slug)}" is already loaded.`;
                }

                ctx.loadedPrompts.add(slug);
                return `Loaded "${formatSlug(slug)}".`;
            },
        },
        {
            name: 'unload_prompt' as const,
            description: 'Remove a framework document from context.',
            parameters: UnloadPromptParams,
            executor: (input: { document_name: string }, ctx: PromptToolsContext) => {
                const slug = resolveSlug(input.document_name, config);

                if (!slug) {
                    return `Could not resolve "${input.document_name}".`;
                }

                // Check if always loaded
                if (alwaysLoaded?.has(slug)) {
                    return `"${formatSlug(slug)}" is always loaded and cannot be unloaded.`;
                }

                if (!ctx.loadedPrompts.has(slug)) {
                    return `"${formatSlug(slug)}" is not loaded.`;
                }

                ctx.loadedPrompts.delete(slug);
                return `Unloaded "${formatSlug(slug)}".`;
            },
        },
        {
            name: 'list_prompts' as const,
            description:
                'List loaded and available framework documents. Only use this if you need to discover protocols not already mentioned in your instructions.',
            parameters: ListPromptsParams,
            executor: (_input: Record<string, never>, ctx: PromptToolsContext) => {
                // Combine always-loaded + dynamically loaded
                const alwaysLoadedArray = alwaysLoaded ? Array.from(alwaysLoaded) : [];
                const allLoaded = [...new Set([...alwaysLoadedArray, ...ctx.loadedPrompts])];
                const loaded = allLoaded.map(formatSlug);
                const loadedStr = loaded.length > 0 ? loaded.join(', ') : '(none)';

                // Available = all slugs except always-loaded ones
                const availableSlugs = allowedSlugs.filter((s) => !alwaysLoaded?.has(s));
                const availableStr = availableSlugs.length > 0 ? availableSlugs.map(formatSlug).join(', ') : '(none)';

                return `Loaded: ${loadedStr}\nAvailable: ${availableStr}`;
            },
        },
    ] as const;
}
