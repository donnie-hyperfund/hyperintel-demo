/** Regex for document directives injected by finalize_document */
export const DOCUMENT_DIRECTIVE_REGEX = /::document\[[^\]]+\]\{[^}]+\}/g;

/**
 * Preprocess context messages before sending to inference.
 * Strips injected content (like document directives) that the model shouldn't see.
 *
 * `shapeContextForInference` calls this on BOTH durable history and the current
 * in-progress turn, so it must stay position-agnostic. The directive-stripping
 * below is correct for both. If you add history-only logic (summarisation,
 * age-based pruning, etc.), gate it on `isActiveTurn === false` — it must never
 * touch the turn the model is currently building.
 *
 * @param isActiveTurn true when `messages` is the current in-progress turn.
 */
export function preprocessContext(
    messages: any[],
    _ctx?: unknown,
    _eCtx?: unknown,
    isActiveTurn = false,
): any[] {
    void isActiveTurn; // reserved hook — see doc comment; no behavioural use yet
    return messages.map((msg) => {
        // Only process assistant messages with blocks
        if (msg.role !== 'assistant' || !msg.blocks) return msg;

        // Process blocks - strip directives from text blocks
        const processedBlocks = msg.blocks
            .map((block: any) => {
                if (block.type !== 'text') return block;
                const cleanedContent = block.content?.replace(DOCUMENT_DIRECTIVE_REGEX, '').trim() ?? '';
                return { ...block, content: cleanedContent };
            })
            .filter((b: any) => b.type !== 'text' || b.content); // Remove empty text blocks

        // Also clean the content field if present
        const cleanedContent =
            typeof msg.content === 'string' ? msg.content.replace(DOCUMENT_DIRECTIVE_REGEX, '').trim() : msg.content;

        return { ...msg, blocks: processedBlocks, content: cleanedContent };
    });
}
