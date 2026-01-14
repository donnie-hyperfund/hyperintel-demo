'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type UseAutoScrollOptions = {
    /**
     * Distance from bottom in pixels to consider "at bottom"
     * @default 100
     */
    threshold?: number;
    behavior?: ScrollBehavior;
};

export type UseAutoScrollReturn<T extends HTMLElement> = {
    containerRef: React.RefObject<T | null>;
    isAtBottom: boolean;
    isAutoScrollEnabled: boolean;
    scrollToBottom: (options?: { behavior?: ScrollBehavior }) => void;
};

export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
    dependencies: unknown[],
    options: UseAutoScrollOptions = {},
): UseAutoScrollReturn<T> {
    const { threshold = 100, behavior = 'smooth' } = options;

    const containerRef = useRef<T | null>(null);
    const isAutoScrollEnabled = useRef(true);
    const [isAtBottom, setIsAtBottom] = useState(true);

    const checkIsAtBottom = useCallback(() => {
        const container = containerRef.current;
        if (!container) return true;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        return distanceFromBottom <= threshold;
    }, [threshold]);

    const scrollToBottom = useCallback(
        (scrollOptions?: { behavior?: ScrollBehavior }) => {
            const container = containerRef.current;
            if (!container) return;

            container.scrollTo({
                top: container.scrollHeight,
                behavior: scrollOptions?.behavior ?? behavior,
            });

            // Re-enable auto-scroll when manually scrolling to bottom
            isAutoScrollEnabled.current = true;
            setIsAtBottom(true);
        },
        [behavior],
    );

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let ticking = false;

        const handleScroll = () => {
            if (ticking) return;

            ticking = true;
            requestAnimationFrame(() => {
                const atBottom = checkIsAtBottom();
                setIsAtBottom(atBottom);

                // Enable/disable auto-scroll based on scroll position
                if (atBottom) {
                    isAutoScrollEnabled.current = true;
                } else {
                    isAutoScrollEnabled.current = false;
                }

                ticking = false;
            });
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [checkIsAtBottom]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !isAutoScrollEnabled.current) return;

        requestAnimationFrame(() => {
            container.scrollTo({
                top: container.scrollHeight,
                behavior: 'instant',
            });
        });
    }, dependencies);

    return {
        containerRef,
        isAtBottom,
        isAutoScrollEnabled: isAutoScrollEnabled.current,
        scrollToBottom,
    };
}
