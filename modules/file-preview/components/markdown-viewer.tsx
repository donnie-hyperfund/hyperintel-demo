'use client';

import { useRef } from 'react';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';

type MarkdownViewerProps = {
    content: string;
    viewportGap?: number;
};

export function MarkdownViewer({ content, viewportGap = 24 }: MarkdownViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
        <div ref={containerRef} className="h-full overflow-y-auto">
            <div style={{ padding: viewportGap }}>
                <MarkdownRenderer markdown={content} variant="document" scrollContainerRef={containerRef} />
            </div>
        </div>
    );
}
