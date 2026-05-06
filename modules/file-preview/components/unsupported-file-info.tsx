'use client';

import { Download, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { downloadBlob } from '@/lib/utils';

type UnsupportedFileInfoProps = {
    src?: string;
    fileName?: string;
};

export function UnsupportedFileInfo({ src, fileName }: UnsupportedFileInfoProps) {
    const handleDownload = async () => {
        if (!src) return;
        try {
            const res = await fetch(src);
            const blob = await res.blob();
            downloadBlob(blob, fileName ?? 'download');
        } catch {
            window.open(src, '_blank');
        }
    };

    return (
        <div className="flex h-full items-center justify-center">
            <EmptyState
                icon={EyeOff}
                title="Preview not available"
                description="This file type cannot be previewed in the browser"
            >
                {src && (
                    <Button variant="outline" size="lg" onClick={handleDownload}>
                        <Download className="size-4 mr-2" />
                        Download file
                    </Button>
                )}
            </EmptyState>
        </div>
    );
}
