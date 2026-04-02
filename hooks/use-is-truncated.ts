import { useCallback, useRef, useState } from 'react';

/**
 * Detects whether a text element is truncated (showing ellipsis).
 * Returns a ref to attach to the element and a boolean indicating truncation.
 *
 * Uses a callback ref so it re-checks whenever the element mounts or changes.
 * Also returns `onMouseEnter` to re-check on hover (handles dynamic content/resizes).
 */
export function useIsTruncated() {
    const ref = useRef<HTMLElement | null>(null);
    const [isTruncated, setIsTruncated] = useState(false);

    const checkTruncation = useCallback(() => {
        const el = ref.current;
        if (el) {
            setIsTruncated(el.scrollWidth > el.clientWidth);
        }
    }, []);

    const callbackRef = useCallback(
        (node: HTMLElement | null) => {
            ref.current = node;
            checkTruncation();
        },
        [checkTruncation],
    );

    return { ref: callbackRef, isTruncated, onMouseEnter: checkTruncation };
}
