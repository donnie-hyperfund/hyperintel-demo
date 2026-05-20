import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isAboveBreakpoint, useBreakpoint } from '@/hooks/use-breakpoint';
import { isImageExtension } from '@/lib/schema/artifact';
import type { ImageUploadIntent } from '@/modules/file-uploads/providers/file-upload-provider';
import { useFileUploadContext } from '@/modules/file-uploads/providers/file-upload-provider';

const LABELS: Record<ImageUploadIntent, string> = {
    'chat-image': 'Attach images to message',
    artifact: 'Upload images as resource',
};

const COMPACT_LABELS: Record<ImageUploadIntent, string> = {
    'chat-image': 'Attach images to message',
    artifact: 'Images as resource',
};

const SHORT_LABELS: Record<ImageUploadIntent, string> = {
    'chat-image': 'Attach to message',
    artifact: 'Upload as resource',
};

export function ImageUploadModeSelector({ disabled }: { disabled: boolean }) {
    const { imageUploadMode, switchImageUploadMode, files, isSwitchingImageMode } = useFileUploadContext();
    const { breakpoint } = useBreakpoint();
    const isSmViewportOrSmaller = !isAboveBreakpoint(breakpoint, 'sm');
    const triggerLabels = isSmViewportOrSmaller ? COMPACT_LABELS : LABELS;

    const hasImagesLoading = files.some((f) => {
        const ext = `.${f.name.split('.').pop()?.toLowerCase()}`;
        return isImageExtension(ext) && f.status !== 'ready';
    });

    const shouldShowLoader = isSwitchingImageMode || hasImagesLoading;

    return (
        <Select
            value={imageUploadMode}
            onValueChange={(v) => switchImageUploadMode(v as ImageUploadIntent)}
            disabled={disabled || shouldShowLoader}
        >
            <SelectTrigger
                className={`h-auto gap-2 border-none bg-transparent dark:bg-transparent p-0 text-xs text-neutral-400 shadow-none hover:enabled:text-neutral-300 dark:hover:bg-transparent transition-colors focus-visible:ring-0 [&_svg]:text-current disabled:cursor-default disabled:opacity-100 min-w-0 w-auto [&_[data-slot=select-value]]:truncate ${
                    shouldShowLoader
                        ? '[&>svg:last-child]:hidden'
                        : '[&>svg:last-child]:transition-transform data-[state=open]:[&>svg:last-child]:rotate-180'
                }`}
            >
                <SelectValue>{triggerLabels[imageUploadMode]}</SelectValue>
                {shouldShowLoader && <Loader2 className="size-3.5 animate-spin" />}
            </SelectTrigger>
            <SelectContent align="start">
                {(Object.entries(LABELS) as [ImageUploadIntent, string][]).map(([value]) => (
                    <SelectItem key={value} value={value} className="text-xs">
                        {SHORT_LABELS[value]}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
