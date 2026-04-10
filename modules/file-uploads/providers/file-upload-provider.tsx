'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { toast } from '@/hooks/use-toast';
import { serializeProjectResourceListKey } from '@/lib/api/client/fetchers/project-resources';
import type { PaginatedResponse } from '@/lib/api/client/types';
import {
    confirmImageUpload,
    confirmUpload,
    deleteArtifact,
    presignImageUpload,
    presignUpload,
    uploadArtifact,
} from '@/lib/api/requests/worker/chat';
import { validateArtifactFile } from '@/lib/artifacts/utils';
import {
    type ArtifactDto,
    isBinaryArtifactExtension,
    isImageExtension,
    type PresignUploadResponseDto,
} from '@/lib/schema/artifact';
import type { ProjectResourceUploadUpdatedPayload } from '@/lib/schema/user-events';
import { getUploadStorageKey } from '@/lib/storage/storage-keys';
import { resolveImageDimensions } from '@/modules/file-uploads/utils/resolve-image-dimensions';
import { useCrossTabUploadSync } from '../hooks/use-cross-tab-upload-sync';
import { useProjectResourceUploadSync } from '../hooks/use-project-resource-upload-sync';
import { usePendingUploads } from '../providers/pending-uploads-provider';
import type { FileEntry, FileEntryStatus } from '../types';
import { findFileEntryIndex, mergeFileEntry } from '../utils/file-entry';
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

const IMAGE_MIME_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

type UploadBatch = { pendingIds: Set<string>; total: number; firstName: string };

export type FileUploadContextValue = {
    files: FileEntry[];
    addFiles: (files: File[]) => void;
    removeFile: (index: number) => void;
    clearFiles: () => void;
    submitFiles: () => Promise<void>;
    isSubmitting: boolean;
    /** Consume staged artifact IDs (uploads without scope). Returns IDs and clears the list. */
    consumeStagedArtifactIds: () => string[];
    /** Consume staged image file IDs. Returns IDs and clears the list. */
    consumeStagedImageFileIds: () => string[];
};

const FileUploadContext = createContext<FileUploadContextValue | null>(null);

type FileUploadProviderProps = {
    children: ReactNode;
    scope?: { projectId?: string; chatId?: string };
    /** When true, uploaded artifact IDs are tracked as "pending" so the resource list hides them until the message is sent. */
    trackAsPending?: boolean;
    /** Lazily create the chat if it doesn't exist yet, returns the chatId. Required for image uploads before first message. */
    ensureChatId?: () => Promise<string>;
};

export function FileUploadProvider({ children, scope, trackAsPending = false, ensureChatId }: FileUploadProviderProps) {
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
    const stagedArtifactIdsRef = useRef<string[]>([]);
    const stagedImageFileIdsRef = useRef<string[]>([]);
    const hiddenArtifactIdsRef = useRef(trackAsPending ? (initialPersistedState?.hiddenArtifactIds ?? []) : []);
    hiddenArtifactIdsRef.current = trackAsPending ? pendingArtifactIds : [];
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    const batchesRef = useRef<UploadBatch[]>([]);
    const pollingEntryIdsRef = useRef<Set<string>>(new Set());

    const invalidateResources = useCallback(() => {
        if (scope?.projectId) {
            globalMutate(serializeProjectResourceListKey(scope.projectId));
        }
    }, [globalMutate, scope?.projectId]);

    const upsertFileEntry = useCallback((incoming: FileEntry) => {
        setFiles((prev) => {
            const index = findFileEntryIndex(prev, incoming);
            if (index === -1) return [...prev, incoming];

            const next = [...prev];
            next[index] = mergeFileEntry(prev[index], incoming);
            return next;
        });
    }, []);

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
                replacePendingArtifactIds(parsedState.hiddenArtifactIds);
                invalidateResources();
            } catch {
                clearFiles();
            }
        },
        [clearFiles, invalidateResources, pruneRemovedArtifactsFromResourceCache, replacePendingArtifactIds],
    );

    // Cross-tab sync for draft uploads (chat input chips) via localStorage StorageEvent.
    useCrossTabUploadSync(trackAsPending ? uploadsStorageKey : null, syncFilesFromStorage);

    // Cross-tab sync for Project Intel uploads via WS user_event broadcast.
    // Server broadcasts status at each stage (uploading → processing). Final 'ready'
    // status is discovered by each tab's polling loop since extraction runs async.
    const handleResourceUploadEvent = useCallback(
        (payload: ProjectResourceUploadUpdatedPayload) => {
            upsertFileEntry({
                id: payload.entryId,
                name: payload.name,
                size: payload.size,
                status: payload.status,
                createdAt: Date.now(),
                artifactId: payload.artifactId,
                fileId: payload.fileId,
            });

            if (payload.status === 'ready') {
                invalidateResources();
            }
        },
        [invalidateResources, upsertFileEntry],
    );

    useProjectResourceUploadSync(trackAsPending ? undefined : scope?.projectId, handleResourceUploadEvent);

    // Persist upload entries and resource-hiding state for cross-tab draft sync.
    useEffect(() => {
        if (!uploadsStorageKey) return;

        const persistable = files
            .filter(
                (entry) =>
                    (entry.status === 'processing' && (entry.fileId || entry.presignData?.fileId)) ||
                    (entry.status === 'ready' && (entry.artifactId || entry.imageFileId)),
            )
            .map(({ file: _file, presignData, ...rest }) => ({
                ...rest,
                fileId: rest.fileId ?? presignData?.fileId,
            }));

        writePersistedUploadState(uploadsStorageKey, {
            entries: persistable,
            hiddenArtifactIds: trackAsPending ? pendingArtifactIds : [],
        });
    }, [files, pendingArtifactIds, trackAsPending, uploadsStorageKey]);

    // Re-populate pending artifact IDs from restored file entries on mount
    useEffect(() => {
        if (!trackAsPending) return;
        replacePendingArtifactIds(initialPersistedState?.hiddenArtifactIds ?? []);
    }, [initialPersistedState?.hiddenArtifactIds, replacePendingArtifactIds, trackAsPending]);

    // Re-populate staged refs from restored draft entries so that consume*()
    // returns correct IDs on send after a page refresh. Only entries that were
    // originally uploaded without scope are restored for associateArtifacts();
    // images are only persisted once they already have an uploaded file ID.
    // TODO: cross-tab send needs to be supported too, rebuild these refs in
    // syncFilesFromStorage as well instead of only on mount.
    useEffect(() => {
        if (!trackAsPending) return;

        const entries = initialPersistedState?.entries ?? [];

        const restoredArtifactIds = [
            ...new Set(
                entries
                    .filter(
                        (e): e is FileEntry & { artifactId: string } =>
                            !!e.requiresAssociation &&
                            (e.status === 'processing' || e.status === 'ready') &&
                            !!e.artifactId,
                    )
                    .map((e) => e.artifactId),
            ),
        ];
        if (restoredArtifactIds.length > 0) {
            stagedArtifactIdsRef.current = restoredArtifactIds;
        }

        const restoredImageIds = [
            ...new Set(
                entries
                    .filter((e): e is FileEntry & { imageFileId: string } => e.status === 'ready' && !!e.imageFileId)
                    .map((e) => e.imageFileId),
            ),
        ];
        if (restoredImageIds.length > 0) {
            stagedImageFileIdsRef.current = restoredImageIds;
        }
    }, [initialPersistedState?.entries, trackAsPending]);

    const updateEntry = useCallback((entryId: string, update: Partial<FileEntry>) => {
        setFiles((prev) => prev.map((entry) => (entry.id === entryId ? { ...entry, ...update } : entry)));
    }, []);

    const consumeStagedArtifactIds = useCallback(() => {
        const ids = stagedArtifactIdsRef.current;
        stagedArtifactIdsRef.current = [];
        return ids;
    }, []);

    const consumeStagedImageFileIds = useCallback(() => {
        const ids = stagedImageFileIdsRef.current;
        stagedImageFileIdsRef.current = [];
        return ids;
    }, []);

    const finalizeEntry = useCallback(
        (entryId: string, extra?: Partial<FileEntry>) => {
            pollingEntryIdsRef.current.delete(entryId);
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
            pollingEntryIdsRef.current.delete(entryId);
            const failedEntry = filesRef.current.find((entry) => entry.id === entryId);
            setFiles((prev) => prev.filter((e) => e.id !== entryId));
            if (failedEntry?.artifactId) {
                removePendingArtifactId(failedEntry.artifactId);
                // Clean up the orphaned artifact from the database
                getToken().then((token) => {
                    if (!token) return;
                    deleteArtifact({ artifactId: failedEntry.artifactId! }, token).catch(() => {});
                    pruneRemovedArtifactsFromResourceCache([failedEntry.artifactId!]);
                });
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
        [getToken, invalidateResources, pruneRemovedArtifactsFromResourceCache, removePendingArtifactId],
    );

    const pollFileStatus = useCallback(
        async (fileId: string, entryId: string) => {
            let failures = 0;
            const MAX_FAILURES = 30; // ~60s of consecutive errors before giving up

            const poll = async () => {
                const token = await getToken();
                if (!token) {
                    pollingEntryIdsRef.current.delete(entryId);
                    return;
                }

                let fileStatus: string | undefined;
                try {
                    const res = await fetch(`/api/artifacts/files/status?fileIds=${fileId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!res.ok) {
                        if (++failures >= MAX_FAILURES) {
                            failEntry(entryId, 'Upload timed out — please try again');
                            return;
                        }
                        setTimeout(poll, 2000);
                        return;
                    }

                    const data: { files: { fileId: string; status: string }[] } = await res.json();
                    fileStatus = data.files.find((f) => f.fileId === fileId)?.status;
                    failures = 0; // reset on successful response
                } catch {
                    if (++failures >= MAX_FAILURES) {
                        failEntry(entryId, 'Upload timed out — please try again');
                        return;
                    }
                    setTimeout(poll, 2000);
                    return;
                }

                if (!filesRef.current.some((entry) => entry.id === entryId)) {
                    pollingEntryIdsRef.current.delete(entryId);
                    return;
                }

                if (fileStatus === 'pending_upload') {
                    updateEntry(entryId, { status: 'uploading' });
                    setTimeout(poll, 1000);
                    return;
                }

                if (fileStatus === 'uploaded') {
                    updateEntry(entryId, { status: 'processing' });
                    setTimeout(poll, 2000);
                    return;
                }

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
        [getToken, finalizeEntry, failEntry, updateEntry],
    );

    const startEagerUpload = useCallback(
        async (file: File, entryId: string) => {
            const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
            const isStaged = !scope?.projectId && !scope?.chatId;

            updateEntry(entryId, { status: 'uploading' });

            try {
                const token = await getToken();
                if (!token) throw new Error('Not authenticated');

                if (isImageExtension(ext)) {
                    // Image upload — separate flow, no artifact/document pipeline
                    const chatId = scope?.chatId ?? (ensureChatId ? await ensureChatId() : undefined);
                    if (!chatId) throw new Error('Chat ID required for image uploads');

                    // Resolve natural dimensions so the chat can reserve space before the image loads
                    resolveImageDimensions(file).then((dims) => {
                        if (dims) updateEntry(entryId, { imageWidth: dims.width, imageHeight: dims.height });
                    });

                    const presignRes = await presignImageUpload(
                        { filename: file.name, fileSize: file.size, chatId },
                        token,
                    );
                    if (!presignRes.ok) {
                        const err = await presignRes.json();
                        throw new Error(err.message || 'Presign failed');
                    }

                    const presignData: { uploadUrl: string; fileId: string } = await presignRes.json();
                    updateEntry(entryId, { imageFileId: presignData.fileId });

                    const mimeType = IMAGE_MIME_TYPES[ext] ?? 'application/octet-stream';
                    const putRes = await fetch(presignData.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': mimeType },
                        body: file,
                    });
                    if (!putRes.ok) throw new Error('Upload to storage failed');

                    const confirmRes = await confirmImageUpload({ fileId: presignData.fileId }, token);
                    if (!confirmRes.ok) {
                        const err = await confirmRes.json();
                        throw new Error(err.message || 'Confirm failed');
                    }

                    stagedImageFileIdsRef.current = [...stagedImageFileIdsRef.current, presignData.fileId];
                    finalizeEntry(entryId, { imageFileId: presignData.fileId });
                    return;
                }

                if (isBinaryArtifactExtension(ext)) {
                    const presignRes = await presignUpload(
                        {
                            filename: file.name,
                            fileSize: file.size,
                            clientEntryId: entryId,
                            source: trackAsPending ? 'chat-input' : 'project-resources',
                            ...scope,
                        },
                        token,
                    );

                    if (!presignRes.ok) {
                        const err = await presignRes.json();
                        throw new Error(err.message || 'Presign failed');
                    }

                    const presignData: PresignUploadResponseDto = await presignRes.json();
                    updateEntry(entryId, {
                        artifactId: presignData.artifactId,
                        requiresAssociation: isStaged,
                        fileId: presignData.fileId,
                        presignData,
                    });

                    if (isStaged) {
                        stagedArtifactIdsRef.current = [...stagedArtifactIdsRef.current, presignData.artifactId];
                    }

                    invalidateResources();

                    const mimeType = BINARY_MIME_TYPES[ext] ?? 'application/octet-stream';
                    const putRes = await fetch(presignData.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': mimeType },
                        body: file,
                    });

                    if (!putRes.ok) throw new Error('Upload to storage failed');

                    const confirmRes = await confirmUpload(
                        {
                            fileId: presignData.fileId,
                            versionId: presignData.versionId,
                            clientEntryId: entryId,
                            source: trackAsPending ? 'chat-input' : 'project-resources',
                        },
                        token,
                    );
                    if (!confirmRes.ok) {
                        const err = await confirmRes.json();
                        throw new Error(err.message || 'Confirm failed');
                    }

                    updateEntry(entryId, {
                        status: 'processing',
                        artifactId: presignData.artifactId,
                        requiresAssociation: isStaged,
                        fileId: presignData.fileId,
                        presignData,
                    });
                    addPendingArtifactId(presignData.artifactId);
                } else {
                    const res = await uploadArtifact(
                        {
                            file,
                            clientEntryId: entryId,
                            source: trackAsPending ? 'chat-input' : 'project-resources',
                            ...scope,
                        },
                        token,
                    );

                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.message || 'Upload failed');
                    }

                    const resData: { artifactId?: string } = await res.json();
                    if (resData.artifactId) {
                        addPendingArtifactId(resData.artifactId);
                        if (isStaged) {
                            stagedArtifactIdsRef.current = [...stagedArtifactIdsRef.current, resData.artifactId];
                        }
                    }

                    finalizeEntry(entryId, {
                        artifactId: resData.artifactId,
                        requiresAssociation: !!resData.artifactId && isStaged,
                    });
                }
            } catch (err) {
                failEntry(entryId, err instanceof Error ? err.message : undefined);
            }
        },
        [
            addPendingArtifactId,
            ensureChatId,
            failEntry,
            finalizeEntry,
            getToken,
            invalidateResources,
            scope,
            updateEntry,
            trackAsPending,
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
            if (!entry) return;

            // Keep the eventual send payload in sync with visible chips.
            if (entry.artifactId) {
                stagedArtifactIdsRef.current = stagedArtifactIdsRef.current.filter((id) => id !== entry.artifactId);
            }
            if (entry.imageFileId) {
                stagedImageFileIdsRef.current = stagedImageFileIdsRef.current.filter((id) => id !== entry.imageFileId);
            }

            const artifactId = entry.artifactId;
            if (artifactId) {
                getToken().then(async (token) => {
                    if (!token) {
                        removePendingArtifactId(artifactId);
                        invalidateResources();
                        return;
                    }

                    try {
                        await deleteArtifact({ artifactId }, token);
                        pruneRemovedArtifactsFromResourceCache([artifactId]);
                    } catch {
                        toast({ title: 'Remove failed', description: entry.name, variant: 'destructive' });
                    } finally {
                        removePendingArtifactId(artifactId);
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

    // Poll server for file status once an entry reaches 'processing' (i.e. after confirm).
    // Entries at 'uploading' or 'pending' are still in-flight on the client — no need to poll yet.
    useEffect(() => {
        for (const entry of files) {
            if (entry.status !== 'processing') continue;
            const fileId = entry.fileId ?? entry.presignData?.fileId;
            if (!fileId) continue;
            if (pollingEntryIdsRef.current.has(entry.id)) continue;

            pollingEntryIdsRef.current.add(entry.id);
            void pollFileStatus(fileId, entry.id);
        }
    }, [files, pollFileStatus]);

    return (
        <FileUploadContext.Provider
            value={{
                files,
                addFiles,
                removeFile,
                clearFiles,
                submitFiles,
                isSubmitting,
                consumeStagedArtifactIds,
                consumeStagedImageFileIds,
            }}
        >
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
