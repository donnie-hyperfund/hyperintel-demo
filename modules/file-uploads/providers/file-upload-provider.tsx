'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { toast } from '@/hooks/use-toast';
import { serializeProjectResourceListKey } from '@/lib/api/client/fetchers/project-resources';
import type { PaginatedResponse } from '@/lib/api/client/types';
import { confirmUpload, deleteArtifact, presignUpload, uploadArtifact } from '@/lib/api/requests/worker/chat';
import { validateArtifactFile } from '@/lib/artifacts/utils';
import { type ArtifactDto, isBinaryArtifactExtension, type PresignUploadResponseDto } from '@/lib/schema/artifact';
import { getUploadStorageKey } from '@/lib/storage/storage-keys';
import { useCrossTabUploadSync } from '../hooks/use-cross-tab-upload-sync';
import { usePendingUploads } from '../providers/pending-uploads-provider';
import {
    normalizePersistedUploadState,
    readPersistedUploadState,
    writePersistedUploadState,
} from '../utils/persisted-upload-state';

const BINARY_MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export type FileEntryStatus = 'pending' | 'uploading' | 'processing' | 'ready';

export type FileEntry = {
    id: string;
    name: string;
    size: number;
    status: FileEntryStatus;
    createdAt: number;
    file?: File;
    artifactId?: string;
    presignData?: PresignUploadResponseDto;
};

type UploadBatch = { pendingIds: Set<string>; total: number; firstName: string };

export type FileUploadContextValue = {
    files: FileEntry[];
    addFiles: (files: File[]) => void;
    removeFile: (index: number) => void;
    clearFiles: () => void;
    submitFiles: () => Promise<void>;
    isSubmitting: boolean;
};

const FileUploadContext = createContext<FileUploadContextValue | null>(null);

type FileUploadProviderProps = {
    children: ReactNode;
    scope?: { projectId?: string; chatId?: string };
    /** When true, uploaded artifact IDs are tracked as "pending" so the resource list hides them until the message is sent. */
    trackAsPending?: boolean;
};

export function FileUploadProvider({ children, scope, trackAsPending = false }: FileUploadProviderProps) {
    const {
        pendingArtifactIds,
        addPendingArtifactId: _addPending,
        removePendingArtifactId: _removePending,
        replacePendingArtifactIds: _replacePending,
        clearPendingArtifactIds: _clearPending,
    } = usePendingUploads();
    const addPendingArtifactId: (id: string) => void = trackAsPending ? _addPending : () => {};
    const removePendingArtifactId: (id: string) => void = trackAsPending ? _removePending : () => {};
    const replacePendingArtifactIds: (ids: string[]) => void = trackAsPending ? _replacePending : () => {};
    const clearPendingArtifactIds: () => void = trackAsPending ? _clearPending : () => {};
    const uploadsStorageKey = getUploadStorageKey(scope, trackAsPending);
    const initialPersistedStateRef = useRef(uploadsStorageKey ? readPersistedUploadState(uploadsStorageKey) : null);
    const initialPersistedState = initialPersistedStateRef.current;

    const [files, setFiles] = useState<FileEntry[]>(() => initialPersistedState?.entries ?? []);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;
    const hiddenArtifactIdsRef = useRef(trackAsPending ? (initialPersistedState?.hiddenArtifactIds ?? []) : []);
    hiddenArtifactIdsRef.current = trackAsPending ? pendingArtifactIds : [];
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    const batchesRef = useRef<UploadBatch[]>([]);
    const resumedProcessingIdsRef = useRef<Set<string>>(new Set());

    const invalidateResources = useCallback(() => {
        if (scope?.projectId) {
            globalMutate(serializeProjectResourceListKey(scope.projectId));
        }
    }, [globalMutate, scope?.projectId]);

    const syncPendingArtifactIds = useCallback(
        (artifactIds: string[]) => {
            replacePendingArtifactIds(artifactIds);
        },
        [replacePendingArtifactIds],
    );

    const pruneRemovedArtifactsFromResourceCache = useCallback(
        (artifactIds: string[]) => {
            if (!scope?.projectId || artifactIds.length === 0) return;

            const removedIds = new Set(artifactIds);
            void globalMutate<PaginatedResponse<ArtifactDto>[]>(
                serializeProjectResourceListKey(scope.projectId),
                (currentPages) => {
                    if (!currentPages) return currentPages;

                    let changed = false;
                    const nextPages = currentPages.map((page) => {
                        const nextData = page.data.filter((artifact) => !removedIds.has(artifact.id));
                        if (nextData.length === page.data.length) return page;
                        changed = true;
                        return { ...page, data: nextData };
                    });

                    return changed ? nextPages : currentPages;
                },
                { revalidate: false },
            );
        },
        [globalMutate, scope?.projectId],
    );

    const clearFiles = useCallback(() => {
        setFiles([]);
        clearPendingArtifactIds();
    }, [clearPendingArtifactIds]);

    const syncFilesFromStorage = useCallback(
        (serializedState: string | null) => {
            const previousHiddenArtifactIds = hiddenArtifactIdsRef.current;

            if (serializedState === null) {
                pruneRemovedArtifactsFromResourceCache(previousHiddenArtifactIds);
                clearFiles();
                invalidateResources();
                return;
            }

            try {
                const parsedState = normalizePersistedUploadState(JSON.parse(serializedState));
                if (!parsedState) {
                    clearFiles();
                    return;
                }

                const nextHiddenArtifactIds = new Set(parsedState.hiddenArtifactIds);
                const removedArtifactIds = previousHiddenArtifactIds.filter(
                    (artifactId) => !nextHiddenArtifactIds.has(artifactId),
                );

                pruneRemovedArtifactsFromResourceCache(removedArtifactIds);
                setFiles(parsedState.entries);
                syncPendingArtifactIds(parsedState.hiddenArtifactIds);
                invalidateResources();
            } catch {
                clearFiles();
            }
        },
        [clearFiles, invalidateResources, pruneRemovedArtifactsFromResourceCache, syncPendingArtifactIds],
    );

    // Sync persisted upload state across tabs so stale chips do not linger.
    useCrossTabUploadSync(trackAsPending ? uploadsStorageKey : null, syncFilesFromStorage);

    // Persist upload entries and resource-hiding state for cross-tab draft sync.
    useEffect(() => {
        if (!uploadsStorageKey) return;

        const persistable = files
            .filter(
                (entry) =>
                    (entry.status === 'processing' && entry.presignData) ||
                    (entry.status === 'ready' && entry.artifactId),
            )
            .map(({ file: _file, ...entry }) => entry);

        writePersistedUploadState(uploadsStorageKey, {
            entries: persistable,
            hiddenArtifactIds: trackAsPending ? pendingArtifactIds : [],
        });
    }, [files, pendingArtifactIds, trackAsPending, uploadsStorageKey]);

    // Re-populate pending artifact IDs from restored file entries on mount
    useEffect(() => {
        if (!trackAsPending) return;
        syncPendingArtifactIds(initialPersistedState?.hiddenArtifactIds ?? []);
    }, [initialPersistedState?.hiddenArtifactIds, syncPendingArtifactIds, trackAsPending]);

    const updateEntry = useCallback((entryId: string, update: Partial<FileEntry>) => {
        setFiles((prev) => prev.map((entry) => (entry.id === entryId ? { ...entry, ...update } : entry)));
    }, []);

    const finalizeEntry = useCallback(
        (entryId: string, extra?: Partial<FileEntry>) => {
            updateEntry(entryId, { ...extra, status: 'ready' });
            invalidateResources();

            for (let i = batchesRef.current.length - 1; i >= 0; i--) {
                const batch = batchesRef.current[i];
                if (!batch.pendingIds.delete(entryId)) continue;
                if (batch.pendingIds.size === 0) {
                    toast({
                        title: 'Upload complete',
                        description: batch.total === 1 ? batch.firstName : `${batch.total} files`,
                    });
                    batchesRef.current.splice(i, 1);
                }
            }
        },
        [updateEntry, invalidateResources],
    );

    const failEntry = useCallback(
        (entryId: string, description?: string) => {
            const failedEntry = filesRef.current.find((entry) => entry.id === entryId);
            setFiles((prev) => prev.filter((e) => e.id !== entryId));
            if (failedEntry?.artifactId) {
                removePendingArtifactId(failedEntry.artifactId);
            }
            invalidateResources();
            toast({ title: 'Upload failed', description, variant: 'destructive' });

            for (let i = batchesRef.current.length - 1; i >= 0; i--) {
                const batch = batchesRef.current[i];
                if (!batch.pendingIds.delete(entryId)) continue;
                batch.total--;
                if (batch.pendingIds.size === 0) batchesRef.current.splice(i, 1);
            }
        },
        [invalidateResources, removePendingArtifactId],
    );

    const pollFileStatus = useCallback(
        async (fileId: string, entryId: string) => {
            const poll = async () => {
                const token = await getToken();
                if (!token) return;

                const res = await fetch(`/api/artifacts/files/status?fileIds=${fileId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;

                const data: { files: { fileId: string; status: string }[] } = await res.json();
                const fileStatus = data.files.find((f) => f.fileId === fileId)?.status;

                if (fileStatus === 'processed') {
                    finalizeEntry(entryId);
                    return;
                }

                if (fileStatus === 'error') {
                    failEntry(entryId, 'Something went wrong — please try again');
                    return;
                }

                setTimeout(poll, 2000);
            };

            await poll();
        },
        [getToken, finalizeEntry, failEntry],
    );

    const startEagerUpload = useCallback(
        async (file: File, entryId: string) => {
            const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;

            updateEntry(entryId, { status: 'uploading' });

            try {
                const token = await getToken();
                if (!token) throw new Error('Not authenticated');

                if (isBinaryArtifactExtension(ext)) {
                    const presignRes = await presignUpload(
                        {
                            filename: file.name,
                            fileSize: file.size,
                            ...scope,
                        },
                        token,
                    );

                    if (!presignRes.ok) {
                        const err = await presignRes.json();
                        throw new Error(err.message || 'Presign failed');
                    }

                    const presignData: PresignUploadResponseDto = await presignRes.json();

                    invalidateResources();

                    const mimeType = BINARY_MIME_TYPES[ext] ?? 'application/octet-stream';
                    const putRes = await fetch(presignData.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': mimeType },
                        body: file,
                    });

                    if (!putRes.ok) throw new Error('Upload to storage failed');

                    const confirmRes = await confirmUpload(
                        { fileId: presignData.fileId, versionId: presignData.versionId },
                        token,
                    );
                    if (!confirmRes.ok) {
                        const err = await confirmRes.json();
                        throw new Error(err.message || 'Confirm failed');
                    }

                    updateEntry(entryId, {
                        status: 'processing',
                        artifactId: presignData.artifactId,
                        presignData,
                    });
                    addPendingArtifactId(presignData.artifactId);
                    resumedProcessingIdsRef.current.add(entryId);
                    pollFileStatus(presignData.fileId, entryId);
                } else {
                    const res = await uploadArtifact({ file, ...scope }, token);

                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.message || 'Upload failed');
                    }

                    const resData: { artifactId?: string } = await res.json();
                    if (resData.artifactId) {
                        addPendingArtifactId(resData.artifactId);
                    }

                    finalizeEntry(entryId, { artifactId: resData.artifactId });
                }
            } catch (err) {
                failEntry(entryId, err instanceof Error ? err.message : undefined);
            }
        },
        [
            addPendingArtifactId,
            failEntry,
            finalizeEntry,
            getToken,
            invalidateResources,
            pollFileStatus,
            scope,
            updateEntry,
        ],
    );

    const addFiles = useCallback(
        (newFiles: File[]) => {
            const entries: FileEntry[] = [];
            for (const file of newFiles) {
                const error = validateArtifactFile(file);
                if (error) {
                    toast({ title: error.message, variant: 'destructive' });
                } else {
                    entries.push({
                        id: crypto.randomUUID(),
                        file,
                        name: file.name,
                        size: file.size,
                        status: 'pending',
                        createdAt: Date.now(),
                    });
                }
            }
            if (entries.length === 0) return;

            toast({
                title: 'Uploading',
                description: entries.length === 1 ? entries[0].name : `${entries.length} files`,
            });

            batchesRef.current.push({
                pendingIds: new Set(entries.map((e) => e.id)),
                total: entries.length,
                firstName: entries[0].name,
            });

            setFiles((prev) => {
                queueMicrotask(() => {
                    entries.forEach((entry) => {
                        if (entry.file) {
                            startEagerUpload(entry.file, entry.id);
                        }
                    });
                });

                return [...prev, ...entries];
            });
        },
        [startEagerUpload],
    );

    const removeFile = useCallback(
        (index: number) => {
            const entry = filesRef.current[index];

            if (entry?.artifactId) {
                getToken().then(async (token) => {
                    if (!token) {
                        removePendingArtifactId(entry.artifactId!);
                        invalidateResources();
                        return;
                    }

                    try {
                        await deleteArtifact({ artifactId: entry.artifactId! }, token);
                        pruneRemovedArtifactsFromResourceCache([entry.artifactId!]);
                    } catch {
                        toast({ title: 'Remove failed', description: entry.name, variant: 'destructive' });
                    } finally {
                        removePendingArtifactId(entry.artifactId!);
                        invalidateResources();
                    }
                });
            }

            setFiles((prev) => prev.filter((_, i) => i !== index));
        },
        [getToken, invalidateResources, pruneRemovedArtifactsFromResourceCache, removePendingArtifactId],
    );

    const waitForStatus = useCallback((entryId: string, target: FileEntryStatus): Promise<void> => {
        return new Promise((resolve, reject) => {
            const check = () => {
                const entry = filesRef.current.find((currentEntry) => currentEntry.id === entryId);
                if (!entry) return reject(new Error('Upload failed'));
                if (entry.status === target) return resolve();
                setTimeout(check, 200);
            };

            check();
        });
    }, []);

    const submitFiles = useCallback(async () => {
        setIsSubmitting(true);
        try {
            const current = filesRef.current;

            await Promise.all(
                current.map((entry) => {
                    if (entry.status !== 'ready') {
                        return waitForStatus(entry.id, 'ready');
                    }
                }),
            );

            pruneRemovedArtifactsFromResourceCache(hiddenArtifactIdsRef.current);
            clearFiles();
            invalidateResources();
        } catch (err) {
            toast({
                title: 'Upload failed',
                description: err instanceof Error ? err.message : undefined,
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    }, [waitForStatus, pruneRemovedArtifactsFromResourceCache, clearFiles, invalidateResources]);

    useEffect(() => {
        for (const entry of files) {
            if (entry.status !== 'processing' || !entry.presignData) continue;
            if (resumedProcessingIdsRef.current.has(entry.id)) continue;

            resumedProcessingIdsRef.current.add(entry.id);
            void pollFileStatus(entry.presignData.fileId, entry.id);
        }
    }, [files, pollFileStatus]);

    return (
        <FileUploadContext.Provider value={{ files, addFiles, removeFile, clearFiles, submitFiles, isSubmitting }}>
            {children}
        </FileUploadContext.Provider>
    );
}

export function useFileUploadContext(): FileUploadContextValue {
    const context = useContext(FileUploadContext);
    if (!context) {
        throw new Error('useFileUploadContext must be used within a FileUploadProvider');
    }
    return context;
}
