'use client';

import { useCallback, useState } from 'react';

const SUCCESS_RESET_MS = 2000;

export function useClipboardAction() {
    const [copied, setCopied] = useState(false);
    const copy = useCallback(async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), SUCCESS_RESET_MS);
    }, []);
    return { copied, copy };
}
