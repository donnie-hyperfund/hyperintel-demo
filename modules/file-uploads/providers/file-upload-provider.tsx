'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { toast } from '@/hooks/use-toast';
import { serializeProjectResourceListKey } from '@/lib/api/client/fetchers/project-resources';
import { confirmUpload, deleteArtifact, presignUpload, uploadArtifact } from '@/lib/api/requests/worker/chat';
import { validateArtifactFile } from '@/lib/artifacts/utils';
import { isBinaryArtifactExtension, type PresignUploadResponseDto } from '@/lib/schema/artifact';
import { draftStorageKeys } from '@/lib/storage/draft-storage-keys';
import { safeGetJsonItem, safeRemoveItem, safeSetJsonItem } from '@/lib/storage/local-storage';
import { usePendingUploads } from './pending-uploads-provider';

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
    file?: File;
    artifactId?: string;
    presignData?: PresignUploadResponseDto;
};

type PersistedFileEntry = Omit<FileEntry, 'file'>;

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
        storageKey,
        addPendingArtifactId: _addPending,
        clearPendingArtifactIds: _clearPending,
    } = usePendingUploads();
    const addPendingArtifactId: (id: string) => void = trackAsPending ? _addPending : () => {};
    const clearPendingArtifactIds: () => void = trackAsPending ? _clearPending : () => {};
    const uploadsStorageKey = trackAsPending ? draftStorageKeys(storageKey).uploadedFiles : null;

    const [files, setFiles] = useState<FileEntry[]>(
        () => (uploadsStorageKey ? safeGetJsonItem<PersistedFileEntry[]>(uploadsStorageKey) : null) ?? [],
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    const hadInFlightRef = useRef(false);
    const resumedProcessingIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        const hasFiles = files.length > 0;
        const allReady = hasFiles && files.every((f) => f.status === 'ready');

        if (hadInFlightRef.current && allReady) {
            toast({
                title: 'Upload complete',
                description: files.length === 1 ? files[0].name : `${files.length} files`,
            });
        }

        hadInFlightRef.current = hasFiles && !allReady;
    }, [files]);

    useEffect(() => {
        if (!uploadsStorageKey) return;

        const persistedEntries = files.filter((entry) => entry.artifactId).map(({ file: _file, ...entry }) => entry);

        if (persistedEntries.length > 0) {
            safeSetJsonItem(uploadsStorageKey, persistedEntries);
            return;
        }

        safeRemoveItem(uploadsStorageKey);
    }, [files, uploadsStorageKey]);

    // Re-populate pending artifact IDs from restored file entries on mount
    useEffect(() => {
        if (!trackAsPending) return;
        for (const entry of filesRef.current) {
            if (entry.artifactId) addPendingArtifactId(entry.artifactId);
        }
    }, []);

    const invalidateResources = useCallback(() => {
        if (scope?.projectId) {
            globalMutate(serializeProjectResourceListKey(scope.projectId));
        }
    }, [globalMutate, scope?.projectId]);

    const updateEntry = useCallback((entryId: string, update: Partial<FileEntry>) => {
        setFiles((prev) => prev.map((entry) => (entry.id === entryId ? { ...entry, ...update } : entry)));
    }, []);

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
                    updateEntry(entryId, { status: 'ready' });
                    invalidateResources();
                    return;
                }

                if (fileStatus === 'error') {
                    setFiles((prev) => prev.filter((entryToKeep) => entryToKeep.id !== entryId));
                    toast({
                        title: 'Upload failed',
                        description: 'Something went wrong — please try again',
                        variant: 'destructive',
                    });
                    return;
                }

                setTimeout(poll, 2000);
            };

            await poll();
        },
        [getToken, invalidateResources, updateEntry],
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

                    updateEntry(entryId, {
                        status: 'ready',
                        artifactId: resData.artifactId,
                    });
                    invalidateResources();
                }
            } catch (err) {
                setFiles((prev) => prev.filter((entry) => entry.id !== entryId));
                toast({
                    title: `Failed to upload "${file.name}"`,
                    description: err instanceof Error ? err.message : undefined,
                    variant: 'destructive',
                });
            }
        },
        [addPendingArtifactId, getToken, invalidateResources, pollFileStatus, scope, updateEntry],
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
                    });
                }
            }
            if (entries.length === 0) return;

            toast({
                title: 'Uploading',
                description: entries.length === 1 ? entries[0].name : `${entries.length} files`,
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
                getToken().then((token) => {
                    if (token) {
                        deleteArtifact({ artifactId: entry.artifactId! }, token);
                        invalidateResources();
                    }
                });
            }

            setFiles((prev) => prev.filter((_, i) => i !== index));
        },
        [getToken, invalidateResources],
    );

    const clearFiles = useCallback(() => {
        setFiles([]);
        clearPendingArtifactIds();
    }, [clearPendingArtifactIds]);

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

            setFiles([]);
            clearPendingArtifactIds();
        } catch (err) {
            toast({
                title: 'Upload failed',
                description: err instanceof Error ? err.message : undefined,
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    }, [clearPendingArtifactIds, waitForStatus]);

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
