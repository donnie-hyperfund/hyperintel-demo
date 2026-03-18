import { FileTypeIcon } from '@/components/ui/file-type-icon';
import type { DirectiveHandler } from '@/components/ui/markdown-renderer';
import { formatFileSize } from '@/lib/files';

export const UploadDirective: DirectiveHandler = ({ label, attributes }) => {
    const size = Number(attributes.size);

    return (
        <div className="mb-2 max-w-128">
            <div className="flex items-center gap-3 rounded-3 bg-neutral-700/40 p-2">
                <FileTypeIcon filename={label} size={28} className="mb-0! mt-0!" />
                <span className="truncate text-sm">{label}</span>
                {size > 0 && <span className="text-muted-foreground shrink-0 text-xs">{formatFileSize(size)}</span>}
            </div>
        </div>
    );
};
