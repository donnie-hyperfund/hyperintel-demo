import { FileText, Loader2, Upload, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropZone } from '@/components/ui/drop-zone';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { formatFileSize } from '@/lib/files';
import { ALLOWED_ARTIFACT_EXTENSIONS, MAX_ARTIFACT_UPLOAD_SIZE } from '@/lib/schema/artifact';

const ACCEPT_MAP = Object.fromEntries(ALLOWED_ARTIFACT_EXTENSIONS.map((ext) => [`application/${ext.slice(1)}`, [ext]]));

export function UploadResource() {
    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    const resetState = useCallback(() => {
        setFile(null);
        setIsUploading(false);
    }, []);

    const handleOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next);
            if (!next) resetState();
        },
        [resetState],
    );

    const handleUpload = useCallback(async () => {
        if (!file) return;

        setIsUploading(true);

        // Mock upload — simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 1200));

        toast({ title: `Uploaded "${file.name}"` });
        setOpen(false);
        resetState();
    }, [file, resetState]);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <Tooltip>
                <DialogTrigger>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7">
                            <Upload className="size-4" />
                        </Button>
                    </TooltipTrigger>
                </DialogTrigger>
                <TooltipContent>Upload document</TooltipContent>
            </Tooltip>

            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Upload Resource</DialogTitle>
                </DialogHeader>

                <div className="flex min-w-0 flex-col gap-6 overflow-hidden">
                    <DropZone
                        accept={ACCEPT_MAP}
                        maxSize={MAX_ARTIFACT_UPLOAD_SIZE}
                        onFileDrop={setFile}
                        onFileRejected={(message) => toast({ title: message, variant: 'destructive' })}
                        description={`Accepted formats: ${ALLOWED_ARTIFACT_EXTENSIONS.join(', ')}`}
                        isSuccess={!!file}
                    />

                    {file && <UploadedFileItem file={file} onRemove={() => setFile(null)} />}
                </div>

                <DialogFooter>
                    <Button onClick={handleUpload} disabled={!file || isUploading}>
                        {isUploading && <Loader2 className="size-4 animate-spin" />}
                        {isUploading ? 'Uploading...' : 'Upload'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function UploadedFileItem({ file, onRemove }: { file: File; onRemove: () => void }) {
    return (
        <div className="flex min-w-0 items-center gap-3 overflow-hidden px-1">
            <FileText className="text-muted-foreground size-4 shrink-0" />
            <p className="min-w-0 shrink truncate text-sm">{file.name}</p>
            <p className="text-muted-foreground shrink-0 text-xs">{formatFileSize(file.size)}</p>
            <button
                type="button"
                onClick={onRemove}
                className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer transition-colors"
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}
