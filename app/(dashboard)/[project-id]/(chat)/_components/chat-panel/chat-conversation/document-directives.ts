// Document directive regex for parsing embedded document references
const DIRECTIVE_REGEX = /::document\[([^\]]+)\]\{([^}]+)\}/g;

export type DocumentDirective = {
    name: string;
    version?: number;
    action?: string;
    lines?: number;
    ref?: boolean;
    status?: 'proposed' | 'approved' | 'rejected' | 'superseded';
};

export type ContentSegment = { type: 'text'; content: string } | { type: 'document'; directive: DocumentDirective };

export function parseDocumentDirectives(text: string): DocumentDirective[] {
    const docs: DocumentDirective[] = [];
    let match;
    // Reset regex state
    DIRECTIVE_REGEX.lastIndex = 0;
    while ((match = DIRECTIVE_REGEX.exec(text)) !== null) {
        const name = match[1];
        const attrs = Object.fromEntries(
            match[2].split(' ').map((p) => {
                const [k, v] = p.split('=');
                if (v === undefined) return [k, true];
                return [k, isNaN(+v) ? v : +v];
            }),
        );
        docs.push({ name, ...attrs });
    }
    return docs;
}

export function removeDocumentDirectives(text: string): string {
    return text.replace(DIRECTIVE_REGEX, '').trim();
}

/**
 * Splits text into segments of text and document directives, preserving order.
 * This allows inline rendering of documents where they appear in the text.
 */
export function splitByDocumentDirectives(text: string): ContentSegment[] {
    const segments: ContentSegment[] = [];
    let lastIndex = 0;
    let match;

    // Reset regex state
    DIRECTIVE_REGEX.lastIndex = 0;

    while ((match = DIRECTIVE_REGEX.exec(text)) !== null) {
        // Add text before this directive (if any)
        const textBefore = text.slice(lastIndex, match.index).trim();
        if (textBefore) {
            segments.push({ type: 'text', content: textBefore });
        }

        // Parse the directive
        const name = match[1];
        const attrs = Object.fromEntries(
            match[2].split(' ').map((p) => {
                const [k, v] = p.split('=');
                if (v === undefined) return [k, true];
                return [k, isNaN(+v) ? v : +v];
            }),
        );

        segments.push({
            type: 'document',
            directive: { name, ...attrs },
        });

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last directive
    const textAfter = text.slice(lastIndex).trim();
    if (textAfter) {
        segments.push({ type: 'text', content: textAfter });
    }

    return segments;
}
