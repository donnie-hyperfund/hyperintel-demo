import { Check, Loader2, Upload } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUploadProjectArtifact } from '@/lib/api/client/hooks/use-project-artifacts';
import { UploadStatus } from '@/lib/api/client/types';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

function UploadIcon({ status }: { status: UploadStatus }) {
    if (status === 'uploading') return <Loader2 className="size-4 animate-spin" />;
    if (status === 'success') return <Check className="size-4 text-green-500" />;
    return <Upload className="size-4" />;
}

function getUploadTooltip(status: UploadStatus) {
    if (status === 'uploading') return 'Uploading...';
    if (status === 'success') return 'Uploaded!';
    return 'Upload document';
}

export function ArtifactUploadDocument() {
    const { chatId, projectId } = useChatContext();

    const { fileInputRef, handleFileChange, status, accept } = useUploadProjectArtifact(projectId!, chatId);

    const handleClick = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.blur();
            fileInputRef.current?.click();
        },
        [fileInputRef],
    );

    return (
        <>
            <input ref={fileInputRef} type="file" accept={accept} onChange={handleFileChange} className="hidden" />
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={handleClick}
                        disabled={status !== 'idle'}
                    >
                        <UploadIcon status={status} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{getUploadTooltip(status)}</TooltipContent>
            </Tooltip>
        </>
    );
}
