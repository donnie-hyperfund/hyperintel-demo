const FENCED_CODE_RE = /^(`{3,}|~{3,})/;

/**
 * Splits markdown into chunks at safe boundaries for progressive rendering.
 *
 * Split priority (outside code blocks):
 *  1. Blank line (paragraph boundary) — cleanest split
 *  2. Before a heading — preserves section structure
 *  3. Any line boundary at 2× target — hard cap, may break mid-list/table
 *     but prevents a single chunk from ever growing unbounded
 */
export function splitMarkdownIntoChunks(markdown: string, targetSize = 8_000): string[] {
    if (markdown.length <= targetSize) return [markdown];

    const lines = markdown.split('\n');
    const chunks: string[] = [];
    let currentLines: string[] = [];
    let currentSize = 0;
    let inCodeBlock = false;
    let codeBlockFence = '';

    const flush = () => {
        if (currentLines.length === 0) return;
        const chunk = currentLines.join('\n');
        if (chunk.trim()) chunks.push(chunk);
        currentLines = [];
        currentSize = 0;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();

        // Track fenced code block open/close
        if (!inCodeBlock) {
            const match = trimmed.match(FENCED_CODE_RE);
            if (match) {
                inCodeBlock = true;
                codeBlockFence = match[1];
            }
        } else if (trimmed.startsWith(codeBlockFence) && trimmed.slice(codeBlockFence.length).trim() === '') {
            inCodeBlock = false;
            codeBlockFence = '';
        }

        currentLines.push(line);
        currentSize += line.length + 1;

        // Never split inside a fenced code block
        if (inCodeBlock || currentSize < targetSize) continue;

        // Priority 1: blank line
        if (line.trim() === '') {
            flush();
            continue;
        }

        // Priority 2: next line is a heading
        const nextLine = lines[i + 1];
        if (nextLine !== undefined && /^#{1,6}\s/.test(nextLine)) {
            flush();
            continue;
        }

        // Priority 3: hard cap — force split at any line boundary
        if (currentSize >= targetSize * 2) {
            flush();
        }
    }

    flush();
    return chunks;
}
