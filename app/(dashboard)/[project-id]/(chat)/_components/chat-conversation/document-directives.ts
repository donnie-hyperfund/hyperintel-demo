// Document directive regex for parsing embedded document references
const DIRECTIVE_REGEX = /::document\[([^\]]+)\]\{([^}]+)\}/g;

export function parseDocumentDirectives(text: string) {
    const docs: { name: string; version?: number; action?: string; lines?: number }[] = [];
    let match;
    while ((match = DIRECTIVE_REGEX.exec(text)) !== null) {
        const name = match[1];
        const attrs = Object.fromEntries(
            match[2].split(' ').map((p) => {
                const [k, v] = p.split('=');
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
