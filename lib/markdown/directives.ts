import type { Html, Nodes, Parent, Root, RootContent } from 'mdast';
import { toString as toStringUtil } from 'mdast-util-to-string';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { remark } from 'remark';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

type DirectiveNode =
    | { type: 'containerDirective'; name: string; attributes?: Record<string, string>; children: Nodes[] }
    | { type: 'leafDirective'; name: string; attributes?: Record<string, string>; children: Nodes[] }
    | { type: 'textDirective'; name: string; attributes?: Record<string, string>; children: Nodes[] };

type DirectiveAttributes = Record<string, string>;

export type DirectiveCallback = (directive: DirectiveNode) => { type: 'html'; value: string } | null;

export const directiveHandlers: Record<string, DirectiveCallback> = {
    youtube: (directive: DirectiveNode): { type: 'html'; value: string } => {
        const attributes: DirectiveAttributes = directive.attributes || {};
        const videoId: string = attributes.v || '';
        const label: string =
            directive.children && directive.children.length > 0
                ? toStringUtil(directive.children[0] as Nodes)
                : 'YouTube Video';
        return {
            type: 'html',
            value: `<div class="youtube-embed" data-video-id="${videoId}">
                <iframe 
                    width="560" 
                    height="315" 
                    src="https://www.youtube.com/embed/${videoId}" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowfullscreen>
                </iframe>
                <p class="text-sm text-muted-foreground mt-2">${label}</p>
            </div>`,
        };
    },

    note: (directive: DirectiveNode): { type: 'html'; value: string } => {
        const attributes: DirectiveAttributes = directive.attributes || {};
        const noteType: string = attributes.type || 'info';
        const content: string =
            directive.children && directive.children.length > 0 ? toStringUtil(directive.children[0] as Nodes) : '';
        return {
            type: 'html',
            value: `<div class="note note-${noteType} p-4 rounded-lg border-l-4 mb-4 ${
                noteType === 'warning'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
                    : noteType === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-500'
                      : noteType === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-500'
                        : 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
            }">
                <p class="m-0">${content}</p>
            </div>`,
        };
    },

    callout: (directive: DirectiveNode): { type: 'html'; value: string } => {
        const attributes: DirectiveAttributes = directive.attributes || {};
        const title: string = attributes.title || 'Callout';
        const content: string =
            directive.children && directive.children.length > 0
                ? directive.children
                      .map((child: Nodes) => {
                          if (child.type === 'paragraph') {
                              return `<p>${toStringUtil(child)}</p>`;
                          }
                          return toStringUtil(child);
                      })
                      .join('\n')
                : '';
        return {
            type: 'html',
            value: `<div class="callout p-4 rounded-lg border bg-muted mb-4">
                <h4 class="mt-0 mb-2 font-semibold">${title}</h4>
                <div class="callout-content">${content}</div>
            </div>`,
        };
    },
};

export function remarkDirectiveProcessor(
    handlers: Record<string, DirectiveCallback> = directiveHandlers,
): Plugin<[], Root> {
    return function () {
        return (tree: Root) => {
            visit(tree, (node: Nodes, index: number | undefined, parent: Parent | undefined) => {
                if (
                    node.type === 'containerDirective' ||
                    node.type === 'leafDirective' ||
                    node.type === 'textDirective'
                ) {
                    const directive = node as DirectiveNode;
                    const handler = handlers[directive.name];

                    if (handler && parent && typeof index === 'number') {
                        const result = handler(directive);
                        if (result) {
                            const htmlNode: Html = {
                                type: 'html',
                                value: result.value,
                            };
                            parent.children[index] = htmlNode as RootContent;
                        }
                    }
                }
            });
        };
    };
}

export function processMarkdownWithDirectives(
    markdown: string,
    customHandlers?: Record<string, DirectiveCallback>,
): string {
    const handlers = customHandlers ? { ...directiveHandlers, ...customHandlers } : directiveHandlers;

    const processor = remark()
        .use(remarkDirective)
        .use(remarkDirectiveProcessor(handlers))
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeStringify);

    const result = processor.processSync(markdown);
    return String(result);
}
