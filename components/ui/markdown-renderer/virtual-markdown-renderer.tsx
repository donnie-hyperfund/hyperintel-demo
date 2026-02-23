'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { chunkMarkdown, type MarkdownChunk } from '@/components/ui/markdown-renderer/chunk-markdown';
import type { GlobalCitation } from '@/components/ui/markdown-renderer/citations';
import { getCitationsForChunk } from '@/components/ui/markdown-renderer/get-citations-for-chunk';
import { remarkCitations } from '@/components/ui/markdown-renderer/remark-citations';

const ChunkBlock = React.memo(function ChunkBlock({
    chunk,
    citations,
    baseRemarkPlugins,
    rehypePlugins,
    components,
}: {
    chunk: MarkdownChunk;
    citations?: GlobalCitation[];
    baseRemarkPlugins: any[];
    rehypePlugins: any[];
    components: Partial<Components>;
}) {
    const chunkCitations = useMemo(() => getCitationsForChunk(citations, chunk), [citations, chunk]);

    const remarkPlugins = useMemo(() => {
        if (chunkCitations && chunkCitations.length > 0) {
            return [...baseRemarkPlugins, remarkCitations(chunkCitations)];
        }
        return baseRemarkPlugins;
    }, [baseRemarkPlugins, chunkCitations]);

    return (
        <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
            {chunk.content}
        </Markdown>
    );
});

export function VirtualMarkdownRenderer({
    markdown,
    height = '100vh',
    overscan = 5,
    citations,
    scrollContainerRef,
    baseRemarkPlugins,
    rehypePlugins,
    components,
}: {
    markdown: string;
    height?: string | number;
    overscan?: number;
    citations?: GlobalCitation[];
    /** When provided, the virtualizer observes this element for scroll instead of creating its own scroll container. */
    scrollContainerRef?: React.RefObject<HTMLElement | null>;
    baseRemarkPlugins: any[];
    rehypePlugins: any[];
    components: Partial<Components>;
}) {
    const localScrollRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const chunks = useMemo(() => chunkMarkdown(markdown), [markdown]);

    const isLocalScroll = !scrollContainerRef;

    // Distance from scroll container top to virtualizer top (accounts for padding, headers, etc.)
    const [scrollMargin, setScrollMargin] = useState(0);

    const virtualizer = useVirtualizer({
        count: chunks.length,
        getScrollElement: () => scrollContainerRef?.current ?? localScrollRef.current,
        estimateSize: (index) => Math.max(200, chunks[index].content.length * 0.3),
        overscan,
        scrollMargin,
    });

    // Fix 1: Force virtualizer to read scroll element dimensions after mount.
    // Without this, the virtualizer may see clientHeight=0 and render nothing.
    // Fix 2: Measure scrollMargin so the virtualizer's visible range accounts for
    // content above it (e.g. padding) inside the scroll container.
    useLayoutEffect(() => {
        if (!isLocalScroll && wrapperRef.current && scrollContainerRef?.current) {
            const scrollRect = scrollContainerRef.current.getBoundingClientRect();
            const wrapperRect = wrapperRef.current.getBoundingClientRect();
            setScrollMargin(wrapperRect.top - scrollRect.top + scrollContainerRef.current.scrollTop);
        }
        virtualizer.measure();
    }, []);

    return (
        <div
            ref={isLocalScroll ? localScrollRef : wrapperRef}
            style={isLocalScroll ? { height, overflowY: 'auto' } : undefined}
        >
            <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                {virtualizer.getVirtualItems().map((row) => (
                    <div
                        key={row.key}
                        data-index={row.index}
                        ref={virtualizer.measureElement}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${row.start - scrollMargin}px)`,
                        }}
                    >
                        <ChunkBlock
                            chunk={chunks[row.index]}
                            citations={citations}
                            baseRemarkPlugins={baseRemarkPlugins}
                            rehypePlugins={rehypePlugins}
                            components={components}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
