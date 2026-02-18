'use client';

import { memo, startTransition, useEffect, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';

type LazyMarkdownChunkProps = {
    chunk: string;
    remarkPlugins: any[];
    rehypePlugins: any[];
    components: Partial<Components>;
    /** Render immediately without waiting for IntersectionObserver */
    immediate?: boolean;
};

const PLACEHOLDER_HEIGHT = 120;
const ROOT_MARGIN = '1000px 0px';

/**
 * Two-phase lazy chunk:
 *  Phase 1 – IntersectionObserver detects the chunk is near the viewport
 *  Phase 2 – requestAnimationFrame + startTransition schedules the actual
 *            react-markdown parse as a low-priority update, yielding the
 *            main thread between chunks so the browser stays responsive.
 */
export const LazyMarkdownChunk = memo(function LazyMarkdownChunk({
    chunk,
    remarkPlugins,
    rehypePlugins,
    components,
    immediate = false,
}: LazyMarkdownChunkProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [isNearViewport, setIsNearViewport] = useState(immediate);
    const [isHydrated, setIsHydrated] = useState(immediate);

    // Phase 1: detect proximity to viewport
    useEffect(() => {
        if (isNearViewport) return;
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    observer.disconnect();
                    setIsNearViewport(true);
                }
            },
            { rootMargin: ROOT_MARGIN },
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [isNearViewport]);

    // Phase 2: yield a frame then schedule the heavy markdown render as a transition
    useEffect(() => {
        if (!isNearViewport || isHydrated) return;

        const rafId = requestAnimationFrame(() => {
            startTransition(() => setIsHydrated(true));
        });

        return () => cancelAnimationFrame(rafId);
    }, [isNearViewport, isHydrated]);

    // Not near viewport yet — lightweight placeholder
    if (!isNearViewport) {
        return <div ref={ref} style={{ minHeight: PLACEHOLDER_HEIGHT }} />;
    }

    // Near viewport but markdown not yet parsed — skeleton placeholder
    if (!isHydrated) {
        return (
            <div ref={ref}>
                <div className="animate-pulse space-y-3 py-2">
                    <div className="h-4 w-3/4 rounded bg-foreground/20" />
                    <div className="h-4 w-1/2 rounded bg-foreground/20" />
                </div>
            </div>
        );
    }

    return (
        <div ref={ref}>
            <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
                {chunk}
            </Markdown>
        </div>
    );
});
