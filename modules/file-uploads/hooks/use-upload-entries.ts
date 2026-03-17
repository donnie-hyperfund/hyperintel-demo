import { useEffect, useMemo } from 'react';
import { type FileEntry, useFileUploadContext } from '../providers/file-upload-provider';

/**
 * Returns upload entries not yet present in the API response (placeholders).
 * Once an entry's artifactId appears in `knownArtifactIds`, it drops out of the
 * returned list so the real API item renders at its natural position.
 * Auto-clears upload state once every entry is absorbed.
 */
export function useUploadEntries(knownArtifactIds: Set<string>): FileEntry[] {
    const { files, clearFiles } = useFileUploadContext();

    const placeholders = useMemo(
        () => files.filter((f) => !f.artifactId || !knownArtifactIds.has(f.artifactId)).reverse(),
        [files, knownArtifactIds],
    );

    useEffect(() => {
        if (files.length > 0 && placeholders.length === 0) {
            clearFiles();
        }
    }, [files.length, placeholders.length, clearFiles]);

    return placeholders;
}
