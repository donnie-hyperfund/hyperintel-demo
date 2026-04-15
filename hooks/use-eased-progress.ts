import { useEffect, useRef } from 'react';

/**
 * Remap a progress value (0-99) through an ease-out quadratic curve so early
 * percentages advance faster and it doesn't stall in the middle.
 * e.g. real 30% → ~51%, real 50% → ~75%.
 *
 * Progress only increases (peak-locked) and resets when `key` changes.
 */
export function useEasedProgress(value: number, key?: string | null): number {
    const peakRef = useRef(0);

    peakRef.current = Math.max(peakRef.current, value);

    useEffect(() => {
        peakRef.current = 0;
    }, [key]);

    if (peakRef.current <= 0) return 0;
    const t = peakRef.current / 100;
    const eased = 1 - (1 - t) * (1 - t);
    return Math.round(eased * 100);
}
