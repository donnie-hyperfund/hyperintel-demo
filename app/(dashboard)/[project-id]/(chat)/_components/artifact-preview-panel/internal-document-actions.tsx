'use client';

import { Check, Loader2, X as XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useArtifactApproval } from '@/modules/artifacts/hooks/use-artifact-approval';
import type { ApprovalAction } from '@/modules/artifacts/processing/types';
import { useArtifact } from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactVersion } from '@/modules/artifacts/utils';

type InternalDocumentActionsProps = {
    artifactId: string;
    version: number;
    disabled?: boolean;
    onProcessingChange?: (action: ApprovalAction | null) => void;
};

export function InternalDocumentActions({
    artifactId,
    version,
    disabled = false,
    onProcessingChange,
}: InternalDocumentActionsProps) {
    const artifact = useArtifact(artifactId, version);
    const activeVersion = artifact ? getLatestArtifactVersion(artifact) : undefined;

    const artifactKey = artifact?.key ?? '';
    const artifactVersionId = activeVersion?.id ?? '';

    const { approve, reject, isApproving, isRejecting, isProcessing } = useArtifactApproval({
        artifactId,
        artifactKey,
        version,
        artifactVersionId,
        entityLabel: 'workflow item',
        disabled,
        onProcessingChange,
    });

    if (!artifact || !artifactKey || !artifactVersionId) return null;

    return (
        <div className="mt-5 pt-5 border-t border-border text-foreground">
            <p className="text-sm text-muted-foreground">This workflow item is ready for your confirmation.</p>
            <div className="mt-3 flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={reject} disabled={isProcessing}>
                    {isRejecting ? <Loader2 className="size-3 animate-spin mr-1" /> : <XIcon className="size-3 mr-1" />}
                    Reject
                </Button>
                <Button size="sm" onClick={approve} disabled={isProcessing}>
                    {isApproving ? <Loader2 className="size-3 animate-spin mr-1" /> : <Check className="size-3 mr-1" />}
                    Approve
                </Button>
            </div>
        </div>
    );
}
