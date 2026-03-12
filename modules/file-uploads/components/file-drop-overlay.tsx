'use client';

import { Upload } from 'lucide-react';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { ALLOWED_ARTIFACT_EXTENSIONS } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import { useFileUploadContext } from '../providers/file-upload-provider';

type FileDropZoneProps = {
    children: ReactNode;
    className?: string;
};

export function FileDropOverlay({ children, className }: FileDropZoneProps) {
    const { addFiles } = useFileUploadContext();
    const [isDragging, setIsDragging] = useState(false);
    const dragCounterRef = useRef(0);

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
        <div
            className={cn('relative', className)}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {children}
            <div
                className={cn(
                    'pointer-events-none absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-200',
                    isDragging ? 'opacity-100' : 'opacity-0',
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
        </div>
    );
}
