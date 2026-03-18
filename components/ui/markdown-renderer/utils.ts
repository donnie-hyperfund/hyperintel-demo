// https://github.com/remarkjs/react-markdown/issues/785
export function processKatexInMarkdown(markdown: string) {
    const markdownWithKatexSyntax = markdown
        .replace(/\\\\\[/g, '$$$$') // Replace '\\[' with '$$'
        .replace(/\\\\\]/g, '$$$$') // Replace '\\]' with '$$'
        .replace(/\\\\\(/g, '$$$$') // Replace '\\(' with '$$'
        .replace(/\\\\\)/g, '$$$$') // Replace '\\)' with '$$'
        .replace(/\\\[/g, '$$$$') // Replace '\[' with '$$'
        .replace(/\\\]/g, '$$$$') // Replace '\]' with '$$'
        .replace(/\\\(/g, '$$$$') // Replace '\(' with '$$'
        .replace(/\\\)/g, '$$$$'); // Replace '\)' with '$$';
    return markdownWithKatexSyntax;
}

// Your LaTeX preprocessing function
function normalizeCustomMathTags(input: string): string {
    return (
        input
            // Convert [/math]...[/math] to $$...$$
            .replace(/\[\/math\]([\s\S]*?)\[\/math\]/g, (_, content) => `$$${content.trim()}$$`)

            // Convert [/inline]...[/inline] to $...$
            .replace(/\[\/inline\]([\s\S]*?)\[\/inline\]/g, (_, content) => `$${content.trim()}$`)

            // Convert \( ... \) to $...$ (inline math) - handles both single and double backslashes
            .replace(/\\{1,2}\(([\s\S]*?)\\{1,2}\)/g, (_, content) => `$${content.trim()}$`)

            // Convert \[ ... \] to $$...$$ (block math) - handles both single and double backslashes
            .replace(/\\{1,2}\[([\s\S]*?)\\{1,2}\]/g, (_, content) => `$$${content.trim()}$$`)
    );
}

export function preprocessMarkdown(input: string): string {
    return input.replace(/={6,}/g, (match) => `<span class="md-divider">${match}</span>`);
}
