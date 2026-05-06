'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { ControlButton } from './controls/control-button';
import { Toolbar } from './controls/toolbar';

type MarkdownViewerProps = {
    content: string;
    viewportGap?: number;
};

export function MarkdownViewer({ content, viewportGap = 24 }: MarkdownViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);

    const checkScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.addEventListener('scroll', checkScroll, { passive: true });
        checkScroll();
        return () => el.removeEventListener('scroll', checkScroll);
    }, [checkScroll]);

    const scrollToBottom = useCallback(() => {
        containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }, []);

    return (
        <div className="relative h-full">
            <div ref={containerRef} className="h-full overflow-y-auto">
                <div style={{ padding: viewportGap }}>
                    <MarkdownRenderer markdown={content} variant="document" scrollContainerRef={containerRef} />
                </div>
            </div>
            <Toolbar visible={!isAtBottom}>
                <ControlButton onClick={scrollToBottom} aria-label="Scroll to bottom">
                    <ChevronDown />
                </ControlButton>
            </Toolbar>
        </div>
    );
}
