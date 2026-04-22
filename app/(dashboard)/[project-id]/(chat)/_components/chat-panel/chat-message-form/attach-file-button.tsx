import { Paperclip } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ALLOWED_ARTIFACT_EXTENSIONS } from '@/lib/schema/artifact';
import { useFileUploadContext } from '@/modules/file-uploads/providers/file-upload-provider';

const ACCEPT_STRING = ALLOWED_ARTIFACT_EXTENSIONS.join(',');

export function AttachFileButton({ disabled }: { disabled?: boolean }) {
    const { addFiles } = useFileUploadContext();
    const fileInputRef = useRef<HTMLInputElement>(null);

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
                disabled={disabled}
            />
            <Tooltip>
                <TooltipTrigger asChild>
                    <IconButton onClick={handleClick} disabled={disabled}>
                        <Paperclip />
                    </IconButton>
                </TooltipTrigger>
                <TooltipContent>Attach file</TooltipContent>
            </Tooltip>
        </>
    );
}
