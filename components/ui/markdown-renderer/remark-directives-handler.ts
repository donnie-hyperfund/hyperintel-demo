import type { Root, PhrasingContent } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Remark plugin to handle directives with custom handlers.
 * Directives with registered handlers are converted to custom elements.
 * Directives without handlers are converted back to text syntax.
 */
export function remarkDirectivesHandler(handlers?: Record<string, any>) {
    return function transformer() {
        return function (tree: Root) {
            visit(tree, (node: any) => {
                if (!node || !node.type) return;

                // Handle leaf directives like ::document[name]{attrs}
                if (node.type === 'leafDirective') {
                    // Check if we have a handler for this directive
                    if (handlers && handlers[node.name]) {
                        // Extract label from children
                        const label = node.children?.[0]?.value || node.children?.[0]?.children?.[0]?.value || '';

                        // Convert to custom element with data attributes
                        node.data = node.data || {};
                        node.data.hName = `directive-${node.name}`;
                        node.data.hProperties = {
                            'data-directive-type': 'leaf',
                            'data-directive-name': node.name,
                            'data-directive-label': label,
                            ...Object.fromEntries(
                                Object.entries(node.attributes || {}).map(([k, v]) => [`data-attr-${k}`, v])
                            ),
                        };
                    } else {
                        // No handler - convert back to text syntax
                        const label = node.children?.[0]?.value || node.children?.[0]?.children?.[0]?.value || '';
                        const attrsStr = node.attributes
                            ? `{${Object.entries(node.attributes).map(([k, v]) => `${k}=${v}`).join(' ')}}`
                            : '{}';

                        // Replace with text node showing the syntax
                        node.type = 'text';
                        node.value = `::${node.name}[${label}]${attrsStr}`;
                        delete node.children;
                        delete node.data;
                    }
                }

                // Handle text directives like :document[name]{attrs}
                if (node.type === 'textDirective') {
                    if (handlers && handlers[node.name]) {
                        const label = node.children?.[0]?.value || node.children?.[0]?.children?.[0]?.value || '';

                        node.data = node.data || {};
                        node.data.hName = `directive-${node.name}`;
                        node.data.hProperties = {
                            'data-directive-type': 'text',
                            'data-directive-name': node.name,
                            'data-directive-label': label,
                            ...Object.fromEntries(
                                Object.entries(node.attributes || {}).map(([k, v]) => [`data-attr-${k}`, v])
                            ),
                        };
                    } else {
                        const label = node.children?.[0]?.value || node.children?.[0]?.children?.[0]?.value || '';
                        const attrsStr = node.attributes
                            ? `{${Object.entries(node.attributes).map(([k, v]) => `${k}=${v}`).join(' ')}}`
                            : '{}';

                        node.type = 'text';
                        node.value = `:${node.name}[${label}]${attrsStr}`;
                        delete node.children;
                        delete node.data;
                    }
                }

                // Handle container directives like :::document[name]{attrs}
                if (node.type === 'containerDirective') {
                    if (handlers && handlers[node.name]) {
                        const label = node.children?.[0]?.value || node.children?.[0]?.children?.[0]?.value || '';

                        node.data = node.data || {};
                        node.data.hName = `directive-${node.name}-container`;
                        node.data.hProperties = {
                            'data-directive-type': 'container',
                            'data-directive-name': node.name,
                            'data-directive-label': label,
                            ...Object.fromEntries(
                                Object.entries(node.attributes || {}).map(([k, v]) => [`data-attr-${k}`, v])
                            ),
                        };
                    } else {
                        const label = node.children?.[0]?.value || node.children?.[0]?.children?.[0]?.value || '';
                        const attrsStr = node.attributes
                            ? `{${Object.entries(node.attributes).map(([k, v]) => `${k}=${v}`).join(' ')}}`
                            : '{}';

                        // For container, keep children but wrap with text markers
                        const children = node.children || [];
                        node.type = 'paragraph';
                        node.children = [
                            { type: 'text', value: `:::${node.name}[${label}]${attrsStr}\n` } as any,
                            ...children,
                            { type: 'text', value: '\n:::' } as any,
                        ];
                        delete node.data;
                    }
                }
            });
        };
    };
}
