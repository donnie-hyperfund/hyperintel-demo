'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SEARCH_PARAMS } from '@/lib/search-params';

type ItemWithKey = { id: string; key: string };

export function useHighlightResourceParam<T extends ItemWithKey>(allItems: T[]) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const highlightResource = searchParams.get(SEARCH_PARAMS.HIGHLIGHT_RESOURCE);

    const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
    const appliedKeyRef = useRef<string | null>(null);
    const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const registerRef = useCallback((id: string, element: HTMLDivElement | null) => {
        itemRefs.current[id] = element;
    }, []);

    // Consume the search param and activate the highlight
    useEffect(() => {
        if (!highlightResource || appliedKeyRef.current === highlightResource) return;

        const item = allItems.find((a) => a.key === highlightResource);
        if (!item) return;

        const element = itemRefs.current[item.id];
        if (!element) return;

        appliedKeyRef.current = highlightResource;
        setHighlightedKey(highlightResource);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const params = new URLSearchParams(searchParams.toString());
        params.delete(SEARCH_PARAMS.HIGHLIGHT_RESOURCE);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [allItems, highlightResource, searchParams, router, pathname]);

    // Clear highlight when the CSS animation actually finishes
    useEffect(() => {
        if (!highlightedKey) return;

        const item = allItems.find((a) => a.key === highlightedKey);
        const element = item ? itemRefs.current[item.id] : null;
        if (!element) return;

        const handleAnimationEnd = (e: AnimationEvent) => {
            if (e.animationName === 'highlight-pulse') {
                setHighlightedKey(null);
                appliedKeyRef.current = null;
            }
        };
        element.addEventListener('animationend', handleAnimationEnd);

        return () => element.removeEventListener('animationend', handleAnimationEnd);
    }, [highlightedKey, allItems]);

    return { highlightedKey, registerRef } as const;
}
