import { useEffect, useState, useMemo } from "react";

export function useImageObjectUrl(file: File | undefined): string | null {
    const [url, setUrl] = useState<string | null>(null);

    const stableFile = useMemo(() => file, [file]);

    useEffect(() => {
        if (!stableFile) {
            setUrl(null);
            return;
        }

        const objectUrl = URL.createObjectURL(stableFile);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [stableFile]);

    return url;
}
