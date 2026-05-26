import type { AgentTool } from '@common/ai/agent';
import type { StreamBlock, ToolCallStreamBlock } from '@common/ai/agent/types';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z, type ZodType } from 'zod';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { RecallLocator } from './stream-utils';

const recallSchema = z.object({
    tool_call_id: z.string().describe('The tool_call_id of the historical tool call to retrieve'),
});

function isMatchingToolCallBlock(block: StreamBlock | undefined, toolCallId: string): block is ToolCallStreamBlock {
    return block?.type === 'tool_call' && block.toolCallId === toolCallId;
}

export function createDbBackedRecallTool(opts: {
    em: EntityManager;
    chatId: string;
    recallLookup: Map<string, RecallLocator>;
}): AgentTool<'recall_tool_call', ZodType> {
    return {
        name: 'recall_tool_call',
        description: 'Retrieve the full input/output of a historical tool call whose content was collapsed.',
        parameters: recallSchema,
        toolVisible: false,
        executor: async ({ tool_call_id }) => {
            const locator = opts.recallLookup.get(tool_call_id);
            if (!locator) {
                return {
                    result: { error: `No tool call found with id "${tool_call_id}"` },
                    metadata: {
                        transient: true,
                        cachePolicy: { longPrefix: false, recentTurn: false },
                    },
                };
            }

            // TODO: Consider one forked EM per recall tool instance, guarded by a tiny mutex.
            // MikroORM fork() does not appear to retain child EMs on the parent, and this local
            // fork is clear()ed below, but a shared fork would reduce allocation churn if a run
            // performs many recall_tool_call invocations.
            const recallEm = opts.em.fork();
            try {
                const message = await recallEm.findOne(ChatMessageEntity, {
                    id: locator.messageId,
                    chat: opts.chatId,
                });
                const blocks: StreamBlock[] = Array.isArray(message?.blocks) ? message.blocks : [];
                const indexedBlock = blocks[locator.blockIndex];
                const block = isMatchingToolCallBlock(indexedBlock, tool_call_id)
                    ? indexedBlock
                    : blocks.find((candidate): candidate is ToolCallStreamBlock =>
                          isMatchingToolCallBlock(candidate, tool_call_id),
                      );

                if (!block) {
                    return {
                        result: { error: `No tool call found with id "${tool_call_id}"` },
                        metadata: {
                            transient: true,
                            cachePolicy: { longPrefix: false, recentTurn: false },
                        },
                    };
                }

                return {
                    result: {
                        toolCallId: block.toolCallId,
                        toolName: block.toolName,
                        toolInput: block.toolInput,
                        toolOutput: block.toolOutput,
                    },
                    metadata: {
                        transient: true,
                        cachePolicy: { longPrefix: false, recentTurn: false },
                    },
                };
            } finally {
                recallEm.clear();
            }
        },
    };
}
