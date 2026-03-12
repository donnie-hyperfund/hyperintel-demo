'use client';

import { Loader2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { ALLOWED_ARTIFACT_EXTENSIONS } from '@/lib/schema/artifact';
import { useFileUploadContext } from '@/modules/file-uploads/providers/file-upload-provider';

const ACCEPT_STRING = ALLOWED_ARTIFACT_EXTENSIONS.join(',');

export function UploadResource() {
    const { files, addFiles, clearFiles } = useFileUploadContext();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isUploading = files.some((f) => f.status !== 'ready');
    const prevIsUploadingRef = useRef(isUploading);

    useEffect(() => {
        if (prevIsUploadingRef.current && !isUploading && files.length > 0) {
            toast({ title: `${files.length} file(s) uploaded successfully` });
            clearFiles();
        }
        prevIsUploadingRef.current = isUploading;
    }, [isUploading, files.length, clearFiles]);

    const handleClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const selected = e.target.files;
            if (selected && selected.length > 0) addFiles(Array.from(selected));
            e.target.value = '';
        },
        [addFiles],
    );

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT_STRING}
                onChange={handleChange}
                className="hidden"
            />
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7" onClick={handleClick} disabled={isUploading}>
                        {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{isUploading ? 'Uploading...' : 'Upload document'}</TooltipContent>
            </Tooltip>
        </>
    );
}
