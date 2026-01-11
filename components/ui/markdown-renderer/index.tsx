'use client';
import type React from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeMathjax from 'rehype-mathjax';
import rehypeKatex from 'rehype-katex'
import remarkFootnotesExtra from 'remark-footnotes-extra';
import remarkInlineLinks from 'remark-inline-links';
import rehypeExternalLinks from 'rehype-external-links';

import { useMarkdownComponents } from '@/components/ui/markdown-renderer/use-markdown-components';
import { preprocessMarkdown } from '@/components/ui/markdown-renderer/utils';
import { useMemo } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const markdownVariants = cva(
    'position-relative prose prose-chat prose-inherit',
    {
        variants: {
            diffType: {
                default: '[&_a]:text-blue-400',
                'diff-added': '[&_a]:text-green-400',
                'diff-removed': '[&_a]:text-red-400',
            },
        },
        defaultVariants: {
            diffType: 'default',
        },
    },
);

type MarkdownRendererProps = {
    markdown: string;
    id?: string;
    scrollToId?: (id: string) => void;
} & VariantProps<typeof markdownVariants>;

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
    markdown,
    id,
    diffType,
}) => {
    const preprocessedMarkdown = useMemo(
        () => preprocessMarkdown(markdown),
        [markdown],
    );
    const components = useMarkdownComponents({ id });

    return (
        <div className={cn(markdownVariants({ diffType }))}>
            <Markdown
                remarkPlugins={[
                    remarkBreaks,
                    remarkGfm,
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
