'use client';

import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { formatFileSize } from '@/lib/files';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

type FileThumbnailProps = {
    label: string;
    size: number;
    artifactId?: string;
};

export function FileThumbnail({ label, size, artifactId }: FileThumbnailProps) {
    const { pushPanel } = useActivePanelContext();

    const handleClick = artifactId
        ? () => pushPanel({ panel: 'file-preview', artifactId }, { reset: true })
        : undefined;

    return (
        <div className="mb-2 max-w-128">
            <FileThumbnailContainer onClick={handleClick}>
                <FileTypeIcon filename={label} size={28} className="mb-0! mt-0!" />
                <span className="truncate text-sm">{label}</span>
                {size > 0 && <span className="text-muted-foreground shrink-0 text-xs">{formatFileSize(size)}</span>}
            </FileThumbnailContainer>
        </div>
    );
}

function FileThumbnailContainer({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="flex w-full items-center gap-3 rounded-3 bg-neutral-700/40 p-2 text-left transition-colors hover:bg-neutral-700/60 cursor-pointer"
            >
                {children}
            </button>
        );
    }

    return (
        <div className="flex items-center gap-3 rounded-3 bg-neutral-700/40 p-2">
            {children}
        </div>
    );
}
