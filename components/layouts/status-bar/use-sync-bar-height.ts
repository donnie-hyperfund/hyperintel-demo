'use client';

import { useCallback, useEffect } from 'react';

const CSS_VAR = '--processing-bar-height';

export function useSyncBarHeight(ref: React.RefObject<HTMLDivElement | null>) {
    const update = useCallback(() => {
        const h = ref.current?.offsetHeight ?? 0;
        document.documentElement.style.setProperty(CSS_VAR, `${h}px`);
    }, [ref]);

    useEffect(() => {
        const el = ref.current;
        if (!el) {
            document.documentElement.style.setProperty(CSS_VAR, '0px');
            return;
        }

        const observer = new ResizeObserver(update);
        observer.observe(el);
        update();

        return () => {
            observer.disconnect();
            document.documentElement.style.setProperty(CSS_VAR, '0px');
        };
    }, [ref, update]);
}
