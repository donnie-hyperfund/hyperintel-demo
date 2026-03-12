'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { confirmUpload, presignUpload, uploadArtifact } from '@/lib/api/requests/worker/chat';
import { validateArtifactFile } from '@/lib/artifacts/utils';
import { isBinaryArtifactExtension, type PresignUploadResponseDto } from '@/lib/schema/artifact';

const BINARY_MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export type FileEntryStatus = 'pending' | 'uploading' | 'ready';

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
    submitFiles: (scope: { projectId?: string; chatId?: string }) => Promise<void>;
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

    const updateEntry = useCallback((index: number, update: Partial<FileEntry>) => {
        setFiles((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...update } : entry)));
    }, []);

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

                    updateEntry(index, { status: 'ready', presignData });
                } else {
                    const res = await uploadArtifact({ file, ...scope }, token);

                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.message || 'Upload failed');
                    }

                    updateEntry(index, { status: 'ready' });
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
        [getToken, scope, updateEntry],
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

    const removeFile = useCallback((index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const clearFiles = useCallback(() => {
        setFiles([]);
    }, []);

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

    const submitFiles = useCallback(
        async (submitScope: { projectId?: string; chatId?: string }) => {
            setIsSubmitting(true);
            try {
                const token = await getToken();
                if (!token) throw new Error('Not authenticated');

                const current = filesRef.current;
                const results = await Promise.allSettled(
                    current.map(async (entry) => {
                        const ext = `.${entry.file.name.split('.').pop()?.toLowerCase()}`;

                        // Wait for eager upload if still in progress
                        if (entry.status === 'uploading') {
                            await waitForStatus(entry.file, 'ready');
                        }

                        if (isBinaryArtifactExtension(ext)) {
                            if (!entry.presignData) {
                                throw new Error(`Missing presign data for "${entry.file.name}"`);
                            }

                            const confirmRes = await confirmUpload(
                                { fileId: entry.presignData.fileId, versionId: entry.presignData.versionId },
                                token,
                            );
                            if (!confirmRes.ok) {
                                const err = await confirmRes.json();
                                throw new Error(err.message || 'Confirm failed');
                            }
                        }
                    }),
                );

                const failed = results.filter((r) => r.status === 'rejected');
                if (failed.length > 0) {
                    const reason = (failed[0] as PromiseRejectedResult).reason;
                    toast({
                        title: `${failed.length} file(s) failed to upload`,
                        description: reason instanceof Error ? reason.message : undefined,
                        variant: 'destructive',
                    });
                }

                // Remove successful entries, keep failed ones
                setFiles((prev) =>
                    prev.filter((_, i) => {
                        const result = results[i];
                        return result && result.status === 'rejected';
                    }),
                );
            } catch (err) {
                toast({
                    title: 'Upload failed',
                    description: err instanceof Error ? err.message : undefined,
                    variant: 'destructive',
                });
            } finally {
                setIsSubmitting(false);
            }
        },
        [getToken, waitForStatus],
    );

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
