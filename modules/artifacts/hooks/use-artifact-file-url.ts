'use client';

import { useEffect, useState } from 'react';

export function useArtifactFileUrl(fileId: string | undefined) {
    const [url, setUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!fileId) {
            setUrl(null);
            return;
        }

        setIsLoading(true);
        setError(null);

        fetch(`/api/artifacts/files/${fileId}/url`)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch file URL');
                return res.json();
            })
            .then((data) => setUrl(data.url))
            .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
            .finally(() => setIsLoading(false));
    }, [fileId]);

    return { url, isLoading, error };
}
