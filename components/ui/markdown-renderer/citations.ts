import type { StreamBlock } from '@/common/ai/agent/types';

export interface GlobalCitation {
    url: string;
    title?: string;
    cited_text: string;
    start: number;
    end: number;
}

/**
 * Convert block-local citation indices to global positions
 * across concatenated text blocks.
 *
 * NOTE: This function is misplaced - it deals with project-specific StreamBlock types
 * and should be moved to a domain-specific location (e.g., chat conversation utils)
 * rather than living in generic markdown-renderer infrastructure.
 *
 * @param blocks - Array of stream blocks (filters to text blocks)
 * @param separator - String used to join text blocks (default: '\n\n')
 * @returns Object with fullText and citations with global positions
 */
export function convertBlocksToGlobalAnnotations(
    blocks: StreamBlock[],
    separator: string = '\n\n'
): { fullText: string; citations: GlobalCitation[] } {
    const textBlocks = blocks.filter(b => b.type === 'text');
    const separatorLength = separator.length;

    let cumulativePosition = 0;
    const globalCitations: GlobalCitation[] = [];
    const textParts: string[] = [];

    for (const block of textBlocks) {
        // Convert block-local citations to global
        if (block.citations && block.citations.length > 0) {
            for (const citation of block.citations) {
                globalCitations.push({
                    url: citation.url,
                    title: citation.title,
                    cited_text: citation.cited_text,
                    start: cumulativePosition + citation.start_index,
                    end: cumulativePosition + citation.end_index,
                });
            }
        }

        // Add block content
        textParts.push(block.content);

        // Update cumulative position (add separator length for next block)
        cumulativePosition += block.content.length;
        if (textParts.length < textBlocks.length) {
            // Not the last block, account for separator
            cumulativePosition += separatorLength;
        }
    }

    // Join with separator
    const fullText = textParts.join(separator);

    return { fullText, citations: globalCitations };
}
