import { Paperclip } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ALLOWED_ARTIFACT_EXTENSIONS } from '@/lib/schema/artifact';
import { useFileDropContext } from '@/modules/chat/providers/file-drop-provider';

const ACCEPT_STRING = ALLOWED_ARTIFACT_EXTENSIONS.join(',');

export function AttachFileButton() {
    const { addFiles } = useFileDropContext();
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
            />
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-neutral-400"
                        onClick={handleClick}
                    >
                        <Paperclip className="size-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Attach file</TooltipContent>
            </Tooltip>
        </>
    );
}
