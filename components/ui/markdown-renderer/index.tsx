'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { useMemo } from 'react';
import Markdown, { Components } from 'react-markdown';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeKatex from 'rehype-katex';
import rehypeMathjax from 'rehype-mathjax';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkFootnotesExtra from 'remark-footnotes-extra';
import remarkGfm from 'remark-gfm';
import remarkInlineLinks from 'remark-inline-links';
import remarkMath from 'remark-math';
import type { GlobalCitation } from '@/components/ui/markdown-renderer/citations';
import { remarkCitations } from '@/components/ui/markdown-renderer/remark-citations';
import { remarkDirectivesHandler } from '@/components/ui/markdown-renderer/remark-directives-handler';
import { useMarkdownComponents } from '@/components/ui/markdown-renderer/use-markdown-components';
import { preprocessMarkdown } from '@/components/ui/markdown-renderer/utils';
import { cn } from '@/lib/utils';

const markdownVariants = cva('position-relative max-w-none', {
    variants: {
        variant: {
            message: 'prose-message',
            document: 'prose-document',
        },
    },
    defaultVariants: {
        variant: 'document',
    },
});

export type DirectiveHandler = (props: {
    type: 'text' | 'leaf' | 'container';
    name: string;
    label: string;
    attributes: Record<string, string>;
    children?: React.ReactNode;
}) => React.ReactNode;

type MarkdownRendererProps = {
    markdown: string;
    id?: string;
    scrollToId?: (id: string) => void;
    /** Optional citations with global text positions for highlighting */
    citations?: GlobalCitation[];
    /** Custom directive handlers. Key is directive name, value is render function. */
    directives?: Record<string, DirectiveHandler>;
    /** Custom component overrides. Merged with built-in components. */
    customComponents?: Partial<Components>;
} & VariantProps<typeof markdownVariants>;

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
    markdown,
    id,
    variant,
    citations,
    directives,
    customComponents,
}) => {
    const preprocessedMarkdown = useMemo(() => preprocessMarkdown(markdown), [markdown]);
    const builtInComponents = useMarkdownComponents({ id });

    // Generate component handlers from directives prop
    const directiveComponents = useMemo(() => {
        if (!directives) return {};

        const components: Partial<Components> = {};

        Object.entries(directives).forEach(([directiveName, handler]) => {
            // Handle leaf and text directives (both use same element name)
            const componentName = `directive-${directiveName}` as keyof Components;
            components[componentName] = ((props: any) => {
                const type = props['data-directive-type'] || 'leaf';
                const name = props['data-directive-name'] || directiveName;
                const label = props['data-directive-label'] || '';

                // Extract attributes from data-attr-* props
                const attributes: Record<string, string> = {};
                Object.keys(props).forEach((key) => {
                    if (key.startsWith('data-attr-')) {
                        const attrName = key.replace('data-attr-', '');
                        attributes[attrName] = props[key];
                    }
                });

                return handler({
                    type: type as 'text' | 'leaf' | 'container',
                    name,
                    label,
                    attributes,
                    children: props.children,
                });
            }) as any;

            // Handle container directives separately
            const containerName = `directive-${directiveName}-container` as keyof Components;
            components[containerName] = ((props: any) => {
                const name = props['data-directive-name'] || directiveName;
                const label = props['data-directive-label'] || '';

                const attributes: Record<string, string> = {};
                Object.keys(props).forEach((key) => {
                    if (key.startsWith('data-attr-')) {
                        const attrName = key.replace('data-attr-', '');
                        attributes[attrName] = props[key];
                    }
                });

                return handler({
                    type: 'container',
                    name,
                    label,
                    attributes,
                    children: props.children,
                });
            }) as any;
        });

        return components;
    }, [directives]);

    // Merge built-in components with directive handlers and custom overrides
    const components = useMemo(() => {
        return { ...builtInComponents, ...directiveComponents, ...customComponents };
    }, [builtInComponents, directiveComponents, customComponents]);

    // Build remark plugins array with optional citations plugin
    const remarkPlugins = useMemo(() => {
        const plugins: any[] = [
            remarkBreaks,
            remarkGfm,
            remarkDirective, // Parse directive syntax
            remarkDirectivesHandler(directives), // Must run after remarkDirective
            [remarkMath, { singleDollarTextMath: false }],
            remarkFootnotesExtra,
            remarkInlineLinks,
        ];

        // Citations plugin must run last (before remark-rehype)
        if (citations && citations.length > 0) {
            plugins.push(remarkCitations(citations));
        }

        return plugins;
    }, [citations, directives]);

    // Build rehype plugins array
    const rehypePlugins = useMemo(() => {
        const plugins: any[] = [
            rehypeRaw, // Parse HTML tags
            rehypeMathjax,
            rehypeKatex,
            rehypeExternalLinks,
        ];

        return plugins;
    }, []);

    return (
        <div className={cn(markdownVariants({ variant }))}>
            <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
                {preprocessedMarkdown}
            </Markdown>
        </div>
    );
};
export default MarkdownRenderer;
