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

    useEffect(() => {
        if (!highlightResource) {
            appliedKeyRef.current = null;
            setHighlightedKey(null);
            return;
        }

        if (appliedKeyRef.current === highlightResource) return;

        const item = allItems.find((a) => a.key === highlightResource);
        if (!item) return;

        const element = itemRefs.current[item.id];
        if (!element) return;

        appliedKeyRef.current = highlightResource;
        setHighlightedKey(highlightResource);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Clean the param from the URL after consuming it
        const params = new URLSearchParams(searchParams.toString());
        params.delete(SEARCH_PARAMS.HIGHLIGHT_RESOURCE);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });

        const timeout = window.setTimeout(
            () => setHighlightedKey((current) => (current === highlightResource ? null : current)),
            4000,
        );

        return () => window.clearTimeout(timeout);
    }, [allItems, highlightResource, searchParams, router, pathname]);

    return { highlightedKey, registerRef } as const;
}
