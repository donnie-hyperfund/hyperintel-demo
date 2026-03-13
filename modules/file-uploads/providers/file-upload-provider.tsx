'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { toast } from '@/hooks/use-toast';
import { serializeProjectResourceListKey } from '@/lib/api/client/fetchers/project-resources';
import { confirmUpload, deleteArtifact, presignUpload, uploadArtifact } from '@/lib/api/requests/worker/chat';
import { validateArtifactFile } from '@/lib/artifacts/utils';
import { isBinaryArtifactExtension, type PresignUploadResponseDto } from '@/lib/schema/artifact';
import { usePendingUploads } from './pending-uploads-provider';

const BINARY_MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export type FileEntryStatus = 'pending' | 'uploading' | 'processing' | 'ready';

export type FileEntry = {
    file: File;
    status: FileEntryStatus;
    presignData?: PresignUploadResponseDto;
};

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
};

export function FileUploadProvider({ children, scope }: FileUploadProviderProps) {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();
    const { addPendingArtifactId, clearPendingArtifactIds } = usePendingUploads();

    const hadInFlightRef = useRef(false);

    useEffect(() => {
        const hasFiles = files.length > 0;
        const allReady = hasFiles && files.every((f) => f.status === 'ready');

        if (hadInFlightRef.current && allReady) {
            toast({
                title: 'Upload complete',
                description: files.length === 1 ? files[0].file.name : `${files.length} files`,
            });
        }

        hadInFlightRef.current = hasFiles && !allReady;
    }, [files]);

    const invalidateResources = useCallback(() => {
        if (scope?.projectId) {
            globalMutate(serializeProjectResourceListKey(scope.projectId));
        }
    }, [globalMutate, scope?.projectId]);

    const updateEntry = useCallback((index: number, update: Partial<FileEntry>) => {
        setFiles((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...update } : entry)));
    }, []);

    const pollFileStatus = useCallback(
        async (fileId: string, index: number) => {
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
                    updateEntry(index, { status: 'ready' });
                    invalidateResources();
                    return;
                }

                if (fileStatus === 'error') {
                    setFiles((prev) => prev.filter((_, i) => i !== index));
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
        [getToken, updateEntry, invalidateResources],
    );

    const startEagerUpload = useCallback(
        async (file: File, index: number) => {
            const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;

            updateEntry(index, { status: 'uploading' });

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

                    updateEntry(index, { status: 'processing', presignData });
                    addPendingArtifactId(presignData.artifactId);
                    pollFileStatus(presignData.fileId, index);
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

                    updateEntry(index, { status: 'ready' });
                    invalidateResources();
                }
            } catch (err) {
                setFiles((prev) => prev.filter((_, i) => i !== index));
                toast({
                    title: `Failed to upload "${file.name}"`,
                    description: err instanceof Error ? err.message : undefined,
                    variant: 'destructive',
                });
            }
        },
        [getToken, scope, updateEntry, invalidateResources, pollFileStatus, addPendingArtifactId],
    );

    const addFiles = useCallback(
        (newFiles: File[]) => {
            const entries: FileEntry[] = [];
            for (const f of newFiles) {
                const error = validateArtifactFile(f);
                if (error) {
                    toast({ title: error.message, variant: 'destructive' });
                } else {
                    entries.push({ file: f, status: 'pending' });
                }
            }
            if (entries.length === 0) return;

            toast({
                title: 'Uploading',
                description: entries.length === 1 ? entries[0].file.name : `${entries.length} files`,
            });

            setFiles((prev) => {
                const startIndex = prev.length;
                // Schedule eager uploads outside the updater to avoid
                // double-firing in React StrictMode
                queueMicrotask(() => {
                    entries.forEach((entry, i) => {
                        startEagerUpload(entry.file, startIndex + i);
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

            // Delete the artifact from the backend if it was uploaded
            if (entry?.presignData) {
                getToken().then((token) => {
                    if (token) {
                        deleteArtifact({ artifactId: entry.presignData!.artifactId }, token);
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

    // Simple polling helper to wait for an in-flight eager upload
    const waitForStatus = useCallback((file: File, target: FileEntryStatus): Promise<void> => {
        return new Promise((resolve, reject) => {
            const check = () => {
                const entry = filesRef.current.find((e) => e.file === file);
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

            // Wait for all in-flight uploads/processing to finish
            await Promise.all(
                current.map((entry) => {
                    if (entry.status !== 'ready') {
                        return waitForStatus(entry.file, 'ready');
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
    }, [waitForStatus, clearPendingArtifactIds]);

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
