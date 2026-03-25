'use client';

import { cva } from 'class-variance-authority';
import { CheckCircle2, Upload } from 'lucide-react';
import { type Accept, useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';

const dropZoneVariants = cva(
    'group flex flex-col items-center justify-center gap-3 rounded-3 border-2 border-dashed bg-muted/30 px-6 py-10 transition-all',
    {
        variants: {
            state: {
                idle: 'cursor-pointer border-neutral-800 hover:border-neutral-700 hover:bg-muted/40',
                active: 'cursor-pointer border-primary/60 bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]',
                success: 'cursor-default border-green-500/40 bg-green-500/5',
                disabled: 'pointer-events-none opacity-50 border-neutral-800',
            },
        },
        defaultVariants: {
            state: 'idle',
        },
    },
);

type DropZoneProps = {
    onFileDrop: (file: File) => void;
    onFileRejected?: (message: string) => void;
    accept?: Accept;
    maxSize?: number;
    disabled?: boolean;
    description?: string;
    isSuccess?: boolean;
    className?: string;
};

function getDropZoneState(options: { isSuccess?: boolean; disabled?: boolean; isDragActive: boolean }) {
    if (options.isSuccess) return 'success' as const;
    if (options.disabled) return 'disabled' as const;
    if (options.isDragActive) return 'active' as const;
    return 'idle' as const;
}

function DropZone({
    onFileDrop,
    onFileRejected,
    accept,
    maxSize,
    disabled,
    description,
    isSuccess,
    className,
}: DropZoneProps) {
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        multiple: false,
        disabled: disabled || isSuccess,
        accept,
        maxSize,
        onDropAccepted: ([file]) => {
            if (file) onFileDrop(file);
        },
        onDropRejected: ([rejection]) => {
            const message = rejection?.errors[0]?.message ?? 'File not accepted';
            onFileRejected?.(message);
        },
    });

    const state = getDropZoneState({ isSuccess, disabled, isDragActive });

    return (
        <div {...getRootProps()} className={cn(dropZoneVariants({ state }), className)}>
            <input {...getInputProps()} />
            {isSuccess ? (
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-green-500/10">
                        <CheckCircle2 className="size-5 text-green-500" />
                    </div>
                    <p className="text-sm font-medium">Document added successfully.</p>
                </div>
            ) : (
                <>
                    <div
                        className={cn(
                            'flex size-10 items-center justify-center rounded-full transition-colors',
                            isDragActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                        )}
                    >
                        <Upload className="size-5" />
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-medium">
                            Drag & drop your file or <span className="text-primary group-hover:underline">browse</span>
                        </p>
                        {description && <p className="text-muted-foreground mt-1 text-xs">{description}</p>}
                    </div>
                </>
            )}
        </div>
    );
}

export { DropZone };
