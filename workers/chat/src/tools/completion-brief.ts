/**
 * Completion Brief Tool
 *
 * Called before generating a Completion Brief. Loads the CB template prompt
 * into context and returns rich phase context (documents, statuses, phase number)
 * so the agent can produce an accurate brief.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import type { EntityManager } from '@mikro-orm/core';
import { z } from 'zod';
import { getCompletionBriefKey } from '@/lib/artifacts/utils';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { extractDocuments } from '../utils/extract-documents';
import { listDocuments } from './documents/document-service';

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

                // Extract documents from conversation history
                const messages = await ctx.em.find(
                    ChatMessageEntity,
                    { chat: ctx.chatId },
                    { orderBy: { created_at: 'ASC' } },
                );
                const documents = extractDocuments(messages);

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
                }

                // Live document statuses from DB
                const phaseDocNames = new Set(documents.map((d) => d.name));
                if (phaseDocNames.size > 0) {
                    const allDocuments = await listDocuments(ctx.em, { projectId: ctx.projectId });
                    const phaseDocuments = allDocuments.filter((d) => phaseDocNames.has(d.name));
                    if (phaseDocuments.length > 0) {
                        parts.push(
                            ``,
                            `## Current Document Statuses`,
                            `These are live statuses from the database. Users may approve or reject via the UI — use these as source of truth.`,
                        );
                        for (const doc of phaseDocuments) {
                            const status = doc.hasProposed ? 'proposed' : (doc.currentStatus ?? doc.latestStatus);
                            parts.push(`- \`${doc.name}\` (${doc.title}): v${doc.latestVersion}, **${status}**`);
                        }
                    }
                }

                return parts.join('\n');
            },
        },
    ] as const;
}
