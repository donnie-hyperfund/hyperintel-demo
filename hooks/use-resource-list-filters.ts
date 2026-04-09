import { useCallback, useState } from 'react';
import type { OwnershipFilter } from '@/lib/schema/artifact';
import { useDebouncedValue } from './use-debounced-value';

export function useResourceListFilters() {
    const [search, setSearch] = useState('');
    const [ownership, setOwnership] = useState<OwnershipFilter | undefined>();
    const debouncedSearch = useDebouncedValue(search, 300);

    const hasFilters = !!debouncedSearch || !!ownership;

    const reset = useCallback(() => {
        setSearch('');
        setOwnership(undefined);
    }, []);

    return {
        search,
        setSearch,
        /** Debounced search value for API params (or undefined when empty) */
        debouncedSearch: debouncedSearch || undefined,
        ownership,
        setOwnership,
        hasFilters,
        reset,
    };
}
