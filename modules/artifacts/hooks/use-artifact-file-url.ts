'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBlobCache } from '@/lib/cache/blob-cache';

const fileCache = createBlobCache('artifact-files', {
    maxSizeBytes: 1024 * 1024 * 1024, // 1 GB
});

export function useArtifactFileUrl(fileId: string | undefined) {
    const [url, setUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const [fetchKey, setFetchKey] = useState(0);

    const refresh = useCallback(async () => {
        if (!fileId) return;
        await fileCache.remove(fileId);
        setFetchKey((k) => k + 1);
    }, [fileId]);

    useEffect(() => {
        if (!fileId) {
            setUrl(null);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setError(null);

        (async () => {
            try {
                // 1. Check disk cache
                const cached = await fileCache.get(fileId);
                if (cached && !cancelled) {
                    const objectUrl = URL.createObjectURL(cached);
                    objectUrlRef.current = objectUrl;
                    setUrl(objectUrl);
                    setIsLoading(false);
                    return;
                }

                // 2. Fetch signed URL from API
                const res = await fetch(`/api/artifacts/files/${fileId}/url`);
                if (!res.ok) throw new Error('Failed to fetch file URL');
                const { url: signedUrl } = await res.json();

                // 3. Download the actual file
                const fileRes = await fetch(signedUrl);
                if (!fileRes.ok) throw new Error('Failed to download file');
                const blob = await fileRes.blob();

                if (cancelled) return;

                // 4. Cache blob for future use
                await fileCache.put(fileId, blob, blob.type);

                // 5. Create object URL for the viewer
                const objectUrl = URL.createObjectURL(blob);
                objectUrlRef.current = objectUrl;
                setUrl(objectUrl);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = null;
            }
        };
    }, [fileId, fetchKey]);

    return { url, isLoading, error, refresh };
}
