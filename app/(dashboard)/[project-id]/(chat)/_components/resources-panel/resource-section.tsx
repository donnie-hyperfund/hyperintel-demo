import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { ArtifactListItem } from '@/modules/artifacts/components/artifact-list-item';

type ResourceSectionProps = {
    title: string;
    artifacts: ArtifactDto[];
    onRemove?: (artifactId: string) => Promise<void>;
};

export function ResourceSection({ title, artifacts, onRemove }: ResourceSectionProps) {
    if (artifacts.length === 0) return null;

    return (
        <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
            <div className="space-y-2">
                {artifacts.map((artifact) => (
                    <ResourceItem key={artifact.id} artifact={artifact} onRemove={onRemove} />
                ))}
            </div>
        </div>
    );
}

function ResourceItem({
    artifact,
    onRemove,
}: {
    artifact: ArtifactDto;
    onRemove?: (artifactId: string) => Promise<void>;
}) {
    const [isRemoving, setIsRemoving] = useState(false);

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
        <div className="group relative">
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
