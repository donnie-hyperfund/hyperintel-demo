import { useEffect } from 'react';
import { storageKey } from '@/lib/storage/local-storage';

/**
 * Subscribes to cross-tab localStorage changes for a draft-upload key.
 */
export function useCrossTabUploadSync(
    uploadsStorageKey: string | null,
    onStorageChange: (nextValue: string | null) => void,
) {
    useEffect(() => {
        if (!uploadsStorageKey) return;

        const qualifiedKey = storageKey(uploadsStorageKey);
        const onStorage = (e: StorageEvent) => {
            if (e.storageArea !== window.localStorage) return;
            if (e.key !== qualifiedKey) return;
            onStorageChange(e.newValue);
        };

        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [uploadsStorageKey, onStorageChange]);
}
