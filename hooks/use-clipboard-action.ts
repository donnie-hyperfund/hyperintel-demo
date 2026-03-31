'use client';

import { useCallback, useState } from 'react';

const SUCCESS_RESET_MS = 2000;

export function useClipboardAction() {
    const [isCopied, setIsCopied] = useState(false);
    const copy = useCallback(async (text: string) => {
        await navigator.clipboard.writeText(text);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), SUCCESS_RESET_MS);
    }, []);
    return { isCopied, copy };
}
