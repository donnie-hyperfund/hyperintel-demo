import { useEffect, useState } from 'react';

/**
 * Returns a debounced version of the given value.
 * Updates only after the value has been stable for `delay` ms.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);

    return debounced;
}
