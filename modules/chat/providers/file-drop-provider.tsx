'use client';

import { Upload } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { formatFileSize } from '@/lib/files';
import { ALLOWED_ARTIFACT_EXTENSIONS, MAX_ARTIFACT_UPLOAD_SIZE } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';

const ACCEPT_EXTENSIONS = new Set(ALLOWED_ARTIFACT_EXTENSIONS);

function validateFile(file: File): string | null {
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
    if (!ACCEPT_EXTENSIONS.has(ext)) {
        return `Unsupported file type. Accepted: ${ALLOWED_ARTIFACT_EXTENSIONS.join(', ')}`;
    }
    if (file.size > MAX_ARTIFACT_UPLOAD_SIZE) {
        return `File too large (max ${formatFileSize(MAX_ARTIFACT_UPLOAD_SIZE)})`;
    }
    return null;
}

export type FileDropContextValue = {
    files: File[];
    addFiles: (files: File[]) => void;
    removeFile: (index: number) => void;
    clearFiles: () => void;
};

const FileDropContext = createContext<FileDropContextValue | null>(null);

export function FileDropProvider({ children }: { children: ReactNode }) {
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const dragCounterRef = useRef(0);

    const addFiles = useCallback((newFiles: File[]) => {
        const valid: File[] = [];
        for (const f of newFiles) {
            const error = validateFile(f);
            if (error) {
                toast({ title: error, variant: 'destructive' });
            } else {
                valid.push(f);
            }
        }
        if (valid.length > 0) {
            setFiles((prev) => [...prev, ...valid]);
        }
    }, []);

    const removeFile = useCallback((index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const clearFiles = useCallback(() => {
        setFiles([]);
    }, []);

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
        <FileDropContext.Provider value={{ files, addFiles, removeFile, clearFiles }}>
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
