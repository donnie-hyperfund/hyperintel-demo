import type { MarkdownChunk } from '@/components/ui/markdown-renderer/chunk-markdown';
import type { GlobalCitation } from '@/components/ui/markdown-renderer/citations';

export function getCitationsForChunk(
    citations: GlobalCitation[] | undefined,
    chunk: MarkdownChunk,
): GlobalCitation[] | undefined {
    if (!citations || citations.length === 0) return undefined;

    const chunkStart = chunk.sourceOffset;
    const chunkEnd = chunkStart + chunk.content.length - chunk.prefixLength;

    const relevant = citations
        .filter((c) => c.start < chunkEnd && c.end > chunkStart)
        .map((c) => ({
            ...c,
            start: Math.max(0, c.start - chunkStart) + chunk.prefixLength,
            end: Math.min(chunk.content.length - chunk.prefixLength, c.end - chunkStart) + chunk.prefixLength,
        }));

    return relevant.length > 0 ? relevant : undefined;
}
