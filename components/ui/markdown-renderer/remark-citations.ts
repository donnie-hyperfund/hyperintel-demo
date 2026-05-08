import type { PhrasingContent, Root } from 'mdast';
import { visit } from 'unist-util-visit';
import type { GlobalCitation } from './citations';

/**
 * Remark plugin to annotate text with citations using source position offsets.
 * Wraps cited text in link nodes that will become <a> elements.
 * Uses node.position.start.offset/end.offset which are available in mdast.
 */
export function remarkCitations(citations: GlobalCitation[]) {
    return function transformer() {
        return function (tree: Root) {
            if (!tree || !citations || citations.length === 0) {
                return;
            }

            // Sort citations by start position for easier processing
            const sortedCitations = [...citations].sort((a, b) => a.start - b.start);

            // Collect replacements to apply after traversal
            const replacements: Array<{ parent: any; index: number; newNodes: any[] }> = [];

            // Visit parent nodes that have position data
            visit(tree, (parentNode: any) => {
                // Only process nodes with position and children
                if (!parentNode.position?.start?.offset || !parentNode.children) return;

                const parentStart = parentNode.position.start.offset;
                let currentOffset = parentStart;

                // Walk through children and calculate their source positions
                for (let i = 0; i < parentNode.children.length; i++) {
                    const child = parentNode.children[i];

                    // Only process text children
                    if (child.type !== 'text') {
                        // For non-text children, estimate their length (simplified)
                        // This handles things like inline code, emphasis, etc.
                        currentOffset += child.value?.length || 0;
                        continue;
                    }

                    const nodeStart = currentOffset;
                    const nodeEnd = currentOffset + child.value.length;
                    currentOffset = nodeEnd;

                    // Find citations that overlap with this text node
                    const overlappingCitations = sortedCitations.filter(
                        (citation) => citation.start < nodeEnd && citation.end > nodeStart
                    );

                    if (overlappingCitations.length === 0) continue;

                    // Process citations in reverse order (end to start) to maintain indices
                    const newNodes: PhrasingContent[] = [];
                    let lastEnd = child.value.length;

                    for (const citation of overlappingCitations.sort((a, b) => b.start - a.start)) {
                        // Convert source offsets to local text indices
                        const localStart = Math.max(0, citation.start - nodeStart);
                        const localEnd = Math.min(child.value.length, citation.end - nodeStart);

                        // Text after citation
                        if (localEnd < lastEnd) {
                            newNodes.unshift({
                                type: 'text',
                                value: child.value.slice(localEnd, lastEnd),
                            });
                        }

                        // Citation link - set hName and hProperties for remark-rehype
                        const linkNode: any = {
                            type: 'link',
                            url: citation.url,
                            title: citation.title || null,
                            children: [
                                {
                                    type: 'text',
                                    value: child.value.slice(localStart, localEnd),
                                },
                            ],
                            data: {
                                hName: 'a',
                                hProperties: {
                                    href: citation.url,
                                    title: citation.title,
                                    className: ['citation-link'],
                                    'data-cited-text': citation.cited_text,
                                },
                            },
                        };

                        newNodes.unshift(linkNode);

                        lastEnd = localStart;
                    }

                    // Text before first citation
                    if (lastEnd > 0) {
                        newNodes.unshift({
                            type: 'text',
                            value: child.value.slice(0, lastEnd),
                        });
                    }

                    // Store replacement to apply later
                    replacements.push({ parent: parentNode, index: i, newNodes });
                }
            });

            // Apply replacements in reverse order to maintain indices
            for (let i = replacements.length - 1; i >= 0; i--) {
                const { parent, index, newNodes } = replacements[i];
                parent.children.splice(index, 1, ...newNodes);
            }
        };
    };
}
