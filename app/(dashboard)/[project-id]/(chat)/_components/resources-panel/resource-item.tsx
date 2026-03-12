import { Loader2, Trash2 } from 'lucide-react';
import { type Ref, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getArtifactDocumentType } from '@/lib/artifacts/utils';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import { ArtifactListItem } from '@/modules/artifacts/components/artifact-list-item';

const borderColorByType: Record<string, string> = {
    'Company Profile': 'border-l-emerald-500',
    'Human Persona': 'border-l-blue-500',
};

export function ResourceItem({
    artifact,
    onRemove,
    isHighlighted = false,
    itemRef,
}: {
    artifact: ArtifactDto;
    onRemove?: (artifactId: string) => Promise<void>;
    isHighlighted?: boolean;
    itemRef?: Ref<HTMLDivElement>;
}) {
    const [isRemoving, setIsRemoving] = useState(false);
    const docType = getArtifactDocumentType(artifact);
    const borderClass = (docType && borderColorByType[docType]) ?? 'border-l-transparent';

    const handleRemove = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onRemove) return;
        setIsRemoving(true);
        try {
            await onRemove(artifact.id);
        } finally {
            setIsRemoving(false);
        }
    };

    return (
        <div
            ref={itemRef}
            className={cn('group relative rounded-lg border-l-2', borderClass, isHighlighted && 'highlight-pulse')}
        >
            <ArtifactListItem size="sm" artifact={artifact} shouldDisplayVersionInfo={false} />
            {onRemove && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-7 opacity-0 group-hover:opacity-100 transition-opacity text-neutral-500 hover:text-red-400"
                    onClick={handleRemove}
                    disabled={isRemoving}
                >
                    {isRemoving ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
            )}
        </div>
    );
}
