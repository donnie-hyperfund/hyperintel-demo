import type { PresignUploadResponseDto } from '@/lib/schema/artifact';
import { safeGetItem, safeGetJsonItem, safeRemoveItem, safeSetItem } from '@/lib/storage/local-storage';

type PersistedUploadEntry = {
    id: string;
    name: string;
    size: number;
    status: 'pending' | 'uploading' | 'processing' | 'ready';
    createdAt: number;
    artifactId?: string;
    requiresAssociation?: boolean;
    fileId?: string;
    imageFileId?: string;
    presignData?: PresignUploadResponseDto;
};

type PersistedUploadState = {
    entries: PersistedUploadEntry[];
    hiddenArtifactIds: string[];
};

function dedupeArtifactIds(ids: string[]): string[] {
    return [...new Set(ids)];
}

function isPersistedUploadState(value: unknown): value is PersistedUploadState {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<PersistedUploadState>;
    return Array.isArray(candidate.entries) && Array.isArray(candidate.hiddenArtifactIds);
}

export function normalizePersistedUploadState(value: unknown): PersistedUploadState | null {
    if (!value) return null;

    if (isPersistedUploadState(value)) {
        return {
            entries: value.entries.map((entry) => ({
                ...entry,
                fileId: entry.fileId ?? entry.presignData?.fileId,
            })),
            hiddenArtifactIds: dedupeArtifactIds(
                value.hiddenArtifactIds.filter((artifactId): artifactId is string => typeof artifactId === 'string'),
            ),
        };
    }

    if (Array.isArray(value)) {
        const entries = value as PersistedUploadEntry[];
        return {
            entries: entries.map((entry) => ({
                ...entry,
                fileId: entry.fileId ?? entry.presignData?.fileId,
            })),
            hiddenArtifactIds: dedupeArtifactIds(
                entries.flatMap((entry) => (typeof entry.artifactId === 'string' ? [entry.artifactId] : [])),
            ),
        };
    }

    return null;
}

export function readPersistedUploadState(key: string): PersistedUploadState | null {
    return normalizePersistedUploadState(safeGetJsonItem<unknown>(key));
}

export function writePersistedUploadState(key: string, state: PersistedUploadState): void {
    const nextState = {
        entries: state.entries,
        hiddenArtifactIds: dedupeArtifactIds(state.hiddenArtifactIds),
    };

    if (nextState.entries.length === 0 && nextState.hiddenArtifactIds.length === 0) {
        if (safeGetItem(key) !== null) {
            safeRemoveItem(key);
        }
        return;
    }

    const serialized = JSON.stringify(nextState);
    if (safeGetItem(key) !== serialized) {
        safeSetItem(key, serialized);
    }
}
