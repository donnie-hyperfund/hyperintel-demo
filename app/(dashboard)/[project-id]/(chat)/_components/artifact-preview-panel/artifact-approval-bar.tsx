'use client';

import { Check, Loader2, X as XIcon } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useApproveArtifactVersion, useRejectArtifactVersion } from '@/lib/api/client/hooks/use-artifacts';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';

type ArtifactApprovalBarProps = {
    artifactKey: string;
};

export function ArtifactApprovalBar({ artifactKey }: ArtifactApprovalBarProps) {
    const { updateArtifact } = useArtifactContext();

    const params = useParams();
    const projectId = params?.['project-id'] as string;

    const { trigger: approve, isMutating: isApproving } = useApproveArtifactVersion(projectId, artifactKey);
    const { trigger: reject, isMutating: isRejecting } = useRejectArtifactVersion(projectId, artifactKey);

    const handleApprove = async () => {
        try {
            const updated = await approve();
            if (updated) {
                updateArtifact(artifactKey, updated, { merge: false });
            }
        } catch (err) {
            console.error('Failed to approve:', err);
        }
    };

    const handleReject = async () => {
        try {
            // TODO: What about reason, how should we handle it?
            const updated = await reject('');
            if (updated) {
                updateArtifact(artifactKey, updated, { merge: false });
            }
        } catch (err) {
            console.error('Failed to reject:', err);
        }
    };

    return (
        <div className="border-t border-border px-4 pt-4 pb-6 space-y-2.5">
            <p className="text-xs text-muted-foreground text-center">This document is awaiting your approval</p>
            <div className="flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={handleReject} disabled={isRejecting}>
                    {isRejecting ? (
                        <Loader2 className="size-3 animate-spin mr-1" />
                    ) : (
                        <XIcon className="size-3 mr-1" />
                    )}
                    Reject
                </Button>
                <Button size="sm" onClick={handleApprove} disabled={isApproving}>
                    {isApproving ? (
                        <Loader2 className="size-3 animate-spin mr-1" />
                    ) : (
                        <Check className="size-3 mr-1" />
                    )}
                    Approve
                </Button>
            </div>
        </div>
    );
}
