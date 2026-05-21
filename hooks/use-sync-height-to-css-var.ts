'use client';

import { useCallback, useEffect } from 'react';
import type { CssVar } from '@/lib/css-vars';

export function useSyncHeightToCssVar(ref: React.RefObject<HTMLElement | null>, cssVar: CssVar) {
    const update = useCallback(() => {
        const h = ref.current?.offsetHeight ?? 0;
        document.documentElement.style.setProperty(cssVar, `${h}px`);
    }, [ref, cssVar]);

    useEffect(() => {
        const el = ref.current;
        if (!el) {
            document.documentElement.style.setProperty(cssVar, '0px');
            return;
        }

        const observer = new ResizeObserver(update);
        observer.observe(el);
        update();

        return () => {
            observer.disconnect();
            document.documentElement.style.setProperty(cssVar, '0px');
        };
    }, [ref, update, cssVar]);
}
