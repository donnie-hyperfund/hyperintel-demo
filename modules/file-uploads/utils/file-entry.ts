import type { FileEntry, FileEntryStatus } from '../types';

const FILE_ENTRY_STATUS_RANK: Record<FileEntryStatus, number> = {
    pending: 0,
    uploading: 1,
    processing: 2,
    ready: 3,
};

export function findFileEntryIndex(
    entries: FileEntry[],
    candidate: Pick<FileEntry, 'id' | 'artifactId' | 'fileId'>,
): number {
    return entries.findIndex(
        (entry) =>
            entry.id === candidate.id ||
            (!!candidate.artifactId && entry.artifactId === candidate.artifactId) ||
            (!!candidate.fileId && entry.fileId === candidate.fileId),
    );
}

export function mergeFileEntry(current: FileEntry, next: FileEntry): FileEntry {
    return {
        ...current,
        ...next,
        status:
            FILE_ENTRY_STATUS_RANK[next.status] >= FILE_ENTRY_STATUS_RANK[current.status]
                ? next.status
                : current.status,
        createdAt: current.createdAt,
        artifactId: next.artifactId ?? current.artifactId,
        fileId: next.fileId ?? current.fileId,
        file: current.file ?? next.file,
        presignData: next.presignData ?? current.presignData,
    };
}
