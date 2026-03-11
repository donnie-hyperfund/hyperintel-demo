'use client';

import { useAuth } from '@clerk/nextjs';
import { Upload } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { confirmUpload, presignUpload, uploadArtifact } from '@/lib/api/requests/worker/chat';
import { validateArtifactFile } from '@/lib/artifacts/utils';
import { ALLOWED_ARTIFACT_EXTENSIONS, isBinaryArtifactExtension, type PresignUploadResponseDto } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';

const BINARY_MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export type FileEntryStatus = 'pending' | 'uploading' | 'ready' | 'error';

export type FileEntry = {
    file: File;
    status: FileEntryStatus;
    presignData?: PresignUploadResponseDto;
};

export type FileDropContextValue = {
    files: FileEntry[];
    addFiles: (files: File[]) => void;
    removeFile: (index: number) => void;
    clearFiles: () => void;
    submitFiles: (scope: { projectId?: string; chatId?: string }) => Promise<void>;
    isSubmitting: boolean;
};

const FileDropContext = createContext<FileDropContextValue | null>(null);

type FileDropProviderProps = {
    children: ReactNode;
    scope?: { projectId?: string; chatId?: string };
};

export function FileDropProvider({ children, scope }: FileDropProviderProps) {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const dragCounterRef = useRef(0);
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
                    const res = await uploadArtifact(
                        { file, ...scope },
                        token,
                    );

                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.message || 'Upload failed');
                    }

                    updateEntry(index, { status: 'ready' });
                }
            } catch (err) {
                updateEntry(index, { status: 'error' });
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
                if (!entry || entry.status === 'error') return reject(new Error('Upload failed'));
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

                        if (isBinaryArtifactExtension(ext)) {
                            // Wait for eager upload if still in progress
                            if (entry.status === 'uploading') {
                                await waitForStatus(entry.file, 'ready');
                            }
                            if (entry.status === 'error') {
                                throw new Error(`Upload failed for "${entry.file.name}"`);
                            }
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
                        } else {
                            // Text file — already uploaded eagerly
                            if (entry.status === 'uploading') {
                                await waitForStatus(entry.file, 'ready');
                            }
                            if (entry.status === 'error') {
                                throw new Error(`Upload failed for "${entry.file.name}"`);
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

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current += 1;
        if (dragCounterRef.current === 1) setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current === 0) setIsDragging(false);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            dragCounterRef.current = 0;
            setIsDragging(false);

            const dropped = Array.from(e.dataTransfer.files);
            if (dropped.length === 0) return;
            addFiles(dropped);
        },
        [addFiles],
    );

    return (
        <FileDropContext.Provider value={{ files, addFiles, removeFile, clearFiles, submitFiles, isSubmitting }}>
            <div
                className="relative h-full"
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                {children}
                <DropOverlay visible={isDragging} />
            </div>
        </FileDropContext.Provider>
    );
}

export function useFileDropContext(): FileDropContextValue {
    const context = useContext(FileDropContext);
    if (!context) {
        throw new Error('useFileDropContext must be used within a FileDropProvider');
    }
    return context;
}

function DropOverlay({ visible }: { visible: boolean }) {
    return (
        <div
            className={cn(
                'pointer-events-none absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-200',
                visible ? 'opacity-100' : 'opacity-0',
            )}
        >
            <div className="absolute inset-0 border-2 border-dashed border-primary/60 bg-[#151815]/90 backdrop-blur-[2px] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]" />
            <div className="relative flex flex-col items-center gap-4">
                <div className="flex size-14 items-center justify-center rounded-full bg-[#192819]/80">
                    <Upload className="size-7 text-primary" />
                </div>
                <div className="text-center">
                    <p className="text-base font-medium">Drop files to upload</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Accepted formats: {ALLOWED_ARTIFACT_EXTENSIONS.join(', ')}
                    </p>
                </div>
            </div>
        </div>
    );
}
