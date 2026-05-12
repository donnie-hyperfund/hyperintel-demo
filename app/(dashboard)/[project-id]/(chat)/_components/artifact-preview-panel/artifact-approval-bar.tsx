'use client';

import { Check, Loader2, X as XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useArtifactApproval } from '@/modules/artifacts/hooks/use-artifact-approval';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import type { ApprovalAction } from '@/modules/artifacts/processing/types';
import { useArtifact } from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactVersion } from '@/modules/artifacts/utils';

type ArtifactApprovalBarProps = {
    artifactId: string;
    version: number;
    disabled?: boolean;
    isStreaming?: boolean;
    onProcessingChange?: (action: ApprovalAction | null) => void;
};

export function ArtifactApprovalBar({
    artifactId,
    version,
    disabled = false,
    isStreaming = false,
    onProcessingChange,
}: ArtifactApprovalBarProps) {
    const artifact = useArtifact(artifactId, version);
    const activeVersion = artifact ? getLatestArtifactVersion(artifact) : undefined;

    const artifactKey = artifact?.key ?? '';
    const artifactVersionId = activeVersion?.id ?? '';

    const { isProcessing: isProcessingGlobally } = useArtifactProcessing();
    const alreadyProcessing = isProcessingGlobally(artifactVersionId);

    const { approve, reject, isApproving, isRejecting, isProcessing } = useArtifactApproval({
        artifactId,
        artifactKey,
        version,
        artifactVersionId,
        disabled: disabled || isStreaming || alreadyProcessing || !artifactVersionId,
        onProcessingChange,
    });

    if (!artifact || !artifactKey) return null;

    return (
        <div className="border-t border-border px-4 pt-4 pb-6 space-y-3">
            <p className="text-xs text-muted-foreground text-center w-full">This document is awaiting your approval.</p>
            <div className="flex items-center justify-center gap-2">
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
