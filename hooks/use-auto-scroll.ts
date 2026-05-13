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
            const { scrollTop, scrollHeight } = container;

            // Must run sync — RAF would settle too late to beat a concurrent auto-pin.
            // scrollHeight check: shrinkage means browser-clamped scrollTop, not user up-scroll.
            if (scrollTop < prevScrollTop && scrollHeight >= prevScrollHeight) {
                followRef.current = false;
            }

            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const { scrollTop: top, scrollHeight: height, clientHeight } = container;
                const distance = height - top - clientHeight;
                const atBottom = distance <= threshold;

                if (atBottom) followRef.current = true;

                setIsAtBottom(atBottom);
                prevScrollTop = top;
                prevScrollHeight = height;
                ticking = false;
            });
        };

        container.addEventListener('scroll', handleScroll, { passive: true });

        const observer = new ResizeObserver(() => {
            if (followRef.current) {
                container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
            }
            handleScroll();
        });
        observer.observe(container);

        handleScroll();

        return () => {
            container.removeEventListener('scroll', handleScroll);
            observer.disconnect();
        };
    }, [threshold]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (disabled || !followRef.current) return;
        requestAnimationFrame(() => {
            // Re-check — followRef can flip between the outer check and this frame.
            if (!followRef.current) return;
            const container = containerRef.current;
            if (!container) return;
            container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
        });
    }, [...dependencies, disabled]);

    return { containerRef, isAtBottom, isFollowing, scrollToBottom, scrollToTop };
}
