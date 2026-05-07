'use client';

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type UseAutoScrollOptions = {
    /** Distance from bottom in pixels to consider "at bottom". @default 100 */
    threshold?: number;
    /** Default behavior for scrollToTop / scrollToBottom when no override is passed. @default 'smooth' */
    behavior?: ScrollBehavior;
    /** Initial value of the internal follow flag. @default true */
    initialFollow?: boolean;
    /** Disables auto-pin on dependency changes. @default false */
    disabled?: boolean;
};

export type UseAutoScrollReturn<T extends HTMLElement> = {
    containerRef: RefObject<T | null>;
    isAtBottom: boolean;
    isFollowing: () => boolean;
    scrollToBottom: (options?: { behavior?: ScrollBehavior }) => void;
    scrollToTop: (options?: { behavior?: ScrollBehavior }) => void;
};

export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
    dependencies: React.DependencyList = [],
    options: UseAutoScrollOptions = {},
): UseAutoScrollReturn<T> {
    const { threshold = 100, behavior = 'smooth', initialFollow = true, disabled = false } = options;

    const containerRef = useRef<T | null>(null);
    const followRef = useRef(initialFollow);
    const [isAtBottom, setIsAtBottom] = useState(true);

    const scrollToBottom = useCallback(
        (opts?: { behavior?: ScrollBehavior }) => {
            const container = containerRef.current;
            if (!container) return;
            container.scrollTo({ top: container.scrollHeight, behavior: opts?.behavior ?? behavior });
            followRef.current = true;
            setIsAtBottom(true);
        },
        [behavior],
    );

    const scrollToTop = useCallback(
        (opts?: { behavior?: ScrollBehavior }) => {
            const container = containerRef.current;
            if (!container) return;
            container.scrollTo({ top: 0, behavior: opts?.behavior ?? behavior });
            followRef.current = false;
            setIsAtBottom(false);
        },
        [behavior],
    );

    const isFollowing = useCallback(() => followRef.current, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let ticking = false;
        let prevScrollTop = container.scrollTop;
        let prevScrollHeight = container.scrollHeight;

        const handleScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const { scrollTop, scrollHeight, clientHeight } = container;
                const distance = scrollHeight - scrollTop - clientHeight;
                const atBottom = distance <= threshold;

                if (atBottom) {
                    followRef.current = true;
                } else if (scrollTop < prevScrollTop && scrollHeight >= prevScrollHeight) {
                    // Only count as a user up-scroll if scrollHeight didn't shrink — a shrink
                    // means the browser clamped scrollTop involuntarily.
                    followRef.current = false;
                }

                setIsAtBottom(atBottom);
                prevScrollTop = scrollTop;
                prevScrollHeight = scrollHeight;
                ticking = false;
            });
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [threshold]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => {
            if (!followRef.current) return;
            container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (disabled || !followRef.current) return;
        requestAnimationFrame(() => {
            const container = containerRef.current;
            if (!container) return;
            container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
        });
    }, [...dependencies, disabled]);

    return { containerRef, isAtBottom, isFollowing, scrollToBottom, scrollToTop };
}
