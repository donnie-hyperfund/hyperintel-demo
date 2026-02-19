'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useMemo, useRef } from 'react';
import type { Components } from 'react-markdown';
import { type DirectiveHandler, MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { chunkMarkdown, type MarkdownChunk } from '@/components/ui/markdown-renderer/chunk-markdown';
import type { GlobalCitation } from '@/components/ui/markdown-renderer/citations';
import { getCitationsForChunk } from '@/components/ui/markdown-renderer/get-citations-for-chunk';

const ChunkBlock = React.memo(function ChunkBlock({
    chunk,
    citations,
    ...rest
}: {
    chunk: MarkdownChunk;
    citations?: GlobalCitation[];
    id?: string;
    variant?: 'message' | 'document' | null;
    directives?: Record<string, DirectiveHandler>;
    customComponents?: Partial<Components>;
}) {
    const chunkCitations = useMemo(() => getCitationsForChunk(citations, chunk), [citations, chunk]);

    return <MarkdownRenderer {...rest} markdown={chunk.content} citations={chunkCitations} />;
});

export function VirtualMarkdownRenderer({
    markdown,
    height = '100vh',
    overscan = 5,
    citations,
    ...rest
}: {
    markdown: string;
    height?: string | number;
    overscan?: number;
    citations?: GlobalCitation[];
    id?: string;
    variant?: 'message' | 'document' | null;
    directives?: Record<string, DirectiveHandler>;
    customComponents?: Partial<Components>;
    className?: string;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const chunks = useMemo(() => chunkMarkdown(markdown), [markdown]);

    const virtualizer = useVirtualizer({
        count: chunks.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 80,
        overscan,
    });

    return (
        <div ref={parentRef} className={rest.className} style={{ height }}>
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
                            transform: `translateY(${row.start}px)`,
                        }}
                    >
                        <ChunkBlock
                            chunk={chunks[row.index]}
                            citations={citations}
                            id={rest.id}
                            variant={rest.variant}
                            directives={rest.directives}
                            customComponents={rest.customComponents}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
