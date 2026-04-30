import { useEffect, useState } from 'react';

type UsePulsedTextOptions = {
    primaryText: string;
    pulseText?: string;
    pulseEveryMs: number;
    pulseVisibleMs: number;
    resetKey: string;
};

export function usePulsedText({
    primaryText,
    pulseText,
    pulseEveryMs,
    pulseVisibleMs,
    resetKey,
}: UsePulsedTextOptions): { text: string; isPulse: boolean } {
    const [isPulseVisible, setIsPulseVisible] = useState(false);

    useEffect(() => {
        setIsPulseVisible(false);
        if (!pulseText || pulseText === primaryText) return;

        let hideTimer: ReturnType<typeof setTimeout> | undefined;
        const showPulse = () => {
            setIsPulseVisible(true);
            hideTimer = setTimeout(() => setIsPulseVisible(false), pulseVisibleMs);
        };
        const showTimer = setInterval(showPulse, pulseEveryMs);

        return () => {
            clearInterval(showTimer);
            if (hideTimer) clearTimeout(hideTimer);
        };
    }, [primaryText, pulseText, pulseEveryMs, pulseVisibleMs, resetKey]);

    const isPulse = isPulseVisible && !!pulseText && pulseText !== primaryText;
    return { text: isPulse ? pulseText : primaryText, isPulse };
}
