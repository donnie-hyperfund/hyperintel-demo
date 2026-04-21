import { Info, Loader2, Trash2 } from 'lucide-react';
import { type Ref, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { getArtifactDocumentType } from '@/lib/artifacts/utils';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import { ArtifactListItem } from '@/modules/artifacts/components/artifact-list-item';

const borderColorByType: Record<string, string> = {
    'Company Profile': 'border-l-emerald-500',
    'Human Persona': 'border-l-blue-500',
};

const routePrefixByType: Record<string, string> = {
    'Company Profile': '/companies',
    'Human Persona': '/stakeholders',
};

function getResourceRoute(artifact: CamelCaseDto<ArtifactDto>): string | undefined {
    const docType = getArtifactDocumentType(artifact);
    const routePrefix = docType && routePrefixByType[docType];
    const sourceChatId = artifact.metadata?.sourceChatId as string | undefined;
    return routePrefix && sourceChatId ? `${routePrefix}/${sourceChatId}` : undefined;
}

export function isPublicImport(artifact: CamelCaseDto<ArtifactDto>): boolean {
    return artifact.metadata?.importedFromPublic === true;
}

export function ResourceItem({
    artifact,
    onRemove,
    isHighlighted = false,
    itemRef,
}: {
    artifact: CamelCaseDto<ArtifactDto>;
    onRemove?: (artifactId: string) => Promise<void>;
    isHighlighted?: boolean;
    itemRef?: Ref<HTMLDivElement>;
}) {
    const [isRemoving, setIsRemoving] = useState(false);
    const docType = getArtifactDocumentType(artifact);
    const borderClass = (docType && borderColorByType[docType]) ?? 'border-l-transparent';
    const alwaysAttached = isPublicImport(artifact);
    const href = getResourceRoute(artifact);

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
            <ArtifactListItem
                size="sm"
                artifact={artifact}
                shouldDisplayVersionInfo={false}
                badge={alwaysAttached && <AlwaysAttachedBadge />}
                href={href}
            />
            {alwaysAttached ? (
                <AlwaysAttachedInfo />
            ) : (
                onRemove && <RemoveButton onClick={handleRemove} disabled={isRemoving} />
            )}
        </div>
    );
}

function AlwaysAttachedBadge() {
    return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0">
            Always attached
        </Badge>
    );
}

function AlwaysAttachedInfo() {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-7 text-neutral-500 cursor-default">
                    <Info className="size-3.5" />
                </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-52">
                Attached to every project.
            </TooltipContent>
        </Tooltip>
    );
}

function RemoveButton({ onClick, disabled }: { onClick: (e: React.MouseEvent) => void; disabled: boolean }) {
    return (
        <IconButton
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 max-md:opacity-100 group-hover:opacity-100 transition-opacity hover:text-red-400"
            onClick={onClick}
            disabled={disabled}
        >
            {disabled ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </IconButton>
    );
}
