import type { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';

export interface DocumentInfo {
    name: string;
    contentPreview?: string;
}

/**
 * Extract documents created via `begin_document` + `write_document` tool calls
 * from chat messages. Reused by the summarizer and the completion_brief tool.
 *
 * Content preview is taken from the first `write_document` call following each
 * `begin_document` (since `begin_document` itself has no content param).
 */
export function extractDocuments(messages: ChatMessageEntity[]): DocumentInfo[] {
    // Flatten all blocks across messages in order
    const allBlocks: any[] = [];
    for (const msg of messages) {
        if (!msg.blocks) continue;
        for (const block of msg.blocks as any[]) {
            allBlocks.push(block);
        }
    }

    const docs: DocumentInfo[] = [];
    for (let i = 0; i < allBlocks.length; i++) {
        const block = allBlocks[i];
        if (block.type !== 'tool_call' || block.toolName !== 'begin_document') continue;

        const name = block.toolInput?.name;
        if (!name) continue;

        // Look ahead for the first write_document for this document
        let contentPreview: string | undefined;
        for (let j = i + 1; j < allBlocks.length; j++) {
            const next = allBlocks[j];
            if (next.type === 'tool_call' && next.toolName === 'write_document') {
                contentPreview = next.toolInput?.content?.slice(0, 500);
                break;
            }
            // Stop looking if we hit another begin_document or finalize
            if (next.type === 'tool_call' && (next.toolName === 'begin_document' || next.toolName === 'finalize_document')) {
                break;
            }
        }

        docs.push({ name, contentPreview });
    }
    return docs;
}
