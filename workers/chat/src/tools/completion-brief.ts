/**
 * Completion Brief Tool
 *
 * Called before generating a Completion Brief. Loads the CB template prompt
 * into context and returns rich phase context (documents, statuses, phase number)
 * so the agent can produce an accurate brief.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { raw } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { getCompletionBriefKey } from '@/lib/artifacts/utils';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';

// ============================================================================
// TYPES
// ============================================================================

export interface CompletionBriefContext {
    loadedPrompts: Set<string>;
    em: EntityManager;
    projectId: string;
    chatId: string;
}

// ============================================================================
// TOOL GROUP
// ============================================================================

export const CompletionBriefToolGroup: AgentToolGroup = {
    name: 'Completion Brief',
    slug: 'completion_',
    description: 'Tool for preparing Completion Brief generation with phase context.',
    tools: ['completion_brief'],
};

// ============================================================================
// TOOL
// ============================================================================

const CB_SLUG = 'pma/completion-brief';

const CompletionBriefParams = z.object({});

type PhaseDocumentRow = {
    artifact_key: string | null;
    title: string;
    version: number;
    status: string;
    content_preview: string | null;
};

export function createCompletionBriefTools() {
    return [
        {
            name: 'completion_brief' as const,
            description:
                'Prepare for Completion Brief generation. Loads the CB template prompt and returns current phase context: phase number, documents created, and their live statuses. Call this before writing a Completion Brief.',
            parameters: CompletionBriefParams,
            executor: async (_input: Record<string, never>, ctx: CompletionBriefContext) => {
                // Load the CB template prompt if not already loaded
                if (!ctx.loadedPrompts.has(CB_SLUG)) {
                    ctx.loadedPrompts.add(CB_SLUG);
                }

                // Load chat for phase info
                const chat = await ctx.em.findOneOrFail(ChatEntity, ctx.chatId);
                const phaseNumber = chat.phase_index + 1;
                const briefName = getCompletionBriefKey(phaseNumber);
                const today = new Date().toISOString().split('T')[0];

                const documents = (
                    (await ctx.em
                        .createQueryBuilder(ArtifactVersionEntity, 'v')
                        .select([
                            'a.key as artifact_key',
                            'v.title as title',
                            'v.version as version',
                            'v.status as status',
                            raw('left(v.content, 500)').as('content_preview'),
                        ])
                        .leftJoin('v.artifact', 'a')
                        .where({ 'v.chat': ctx.chatId })
                        .orderBy({ 'v.created_at': 'ASC' })
                        .execute('all')) as PhaseDocumentRow[]
                ).map((version) => ({
                    name: version.artifact_key ?? version.title,
                    title: version.title,
                    version: version.version,
                    status: version.status,
                    contentPreview: version.content_preview ?? undefined,
                }));

                // Build result parts
                const parts: string[] = [
                    `## Phase Context`,
                    `- **Phase Number:** ${phaseNumber}`,
                    `- **Brief Name:** \`${briefName}\``,
                    `- **Date:** ${today}`,
                    ``,
                    `The \`completion_brief\` template has been loaded into your context. Follow it exactly.`,
                    `Create the brief as an internal document with \`document_type: 'Completion Brief'\`.`,
                    `The brief will be **proposed** for review — the PE-facing summary is auto-generated after you finalize.`,
                ];

                // Documents created in this conversation
                if (documents.length > 0) {
                    parts.push(``, `## Documents Created During This Conversation`);
                    for (const doc of documents) {
                        parts.push(`### ${doc.name}`);
                        if (doc.contentPreview) {
                            parts.push(`**Preview:**\n\`\`\`\n${doc.contentPreview}\n\`\`\``);
                        }
                    }

                    parts.push(
                        ``,
                        `## Current Document Statuses`,
                        `These are live statuses from the database. Users may approve or reject via the UI — use these as source of truth.`,
                    );
                    for (const doc of documents) {
                        parts.push(`- \`${doc.name}\` (${doc.title}): v${doc.version}, **${doc.status}**`);
                    }
                }

                return parts.join('\n');
            },
        },
    ] as const;
}
