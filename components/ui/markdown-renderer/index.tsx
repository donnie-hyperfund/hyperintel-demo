'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { useMemo } from 'react';
import Markdown from 'react-markdown';
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
import { useMarkdownComponents } from '@/components/ui/markdown-renderer/use-markdown-components';
import { preprocessMarkdown } from '@/components/ui/markdown-renderer/utils';
import { cn } from '@/lib/utils';

const markdownVariants = cva('position-relative max-w-none', {
    variants: {
        variant: {
            message: 'prose-message',
            document: 'prose-document',
        },
        diffType: {
            default: '[&_a]:text-blue-400',
            'diff-added': '[&_a]:text-green-400',
            'diff-removed': '[&_a]:text-red-400',
        },
    },
    defaultVariants: {
        variant: 'document',
        diffType: 'default',
    },
});

type MarkdownRendererProps = {
    markdown: string;
    id?: string;
    scrollToId?: (id: string) => void;
} & VariantProps<typeof markdownVariants>;

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ markdown, id, diffType, variant }) => {
    const preprocessedMarkdown = useMemo(() => preprocessMarkdown(markdown), [markdown]);
    const components = useMarkdownComponents({ id });

    return (
        <div className={cn(markdownVariants({ diffType, variant }))}>
            <Markdown
                remarkPlugins={[
                    remarkBreaks,
                    remarkGfm,
                    remarkDirective,
                    [remarkMath, { singleDollarTextMath: false }],
                    remarkFootnotesExtra,
                    remarkInlineLinks,
                ]}
                rehypePlugins={
                    [
                        rehypeRaw, // Must come first to parse HTML tags
                        rehypeMathjax,
                        rehypeKatex,
                        rehypeExternalLinks,
                    ] as any
                }
                components={components}
            >
                {preprocessedMarkdown}
            </Markdown>
        </div>
    );
};
export default MarkdownRenderer;
