'use client';

import { Check, Loader2, X as XIcon } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
    useApproveProjectArtifactVersion,
    useRejectProjectArtifactVersion,
} from '@/lib/api/client/hooks/use-project-artifacts';
import { useArtifactContext } from '@/modules/artifacts/providers/artifact-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type ArtifactApprovalBarParams = PageParams<'/[project-id]'>;

type ArtifactApprovalBarProps = {
    artifactId: string;
    artifactKey: string;
    artifactVersion: number;
    onProcessingChange?: (isProcessing: boolean) => void;
};

export function ArtifactApprovalBar({
    artifactId,
    artifactKey,
    artifactVersion,
    onProcessingChange,
}: ArtifactApprovalBarProps) {
    const { updateArtifact, artifacts } = useArtifactContext();
    const { clearPendingChanges } = useChatContext();

    const { 'project-id': projectId } = useParams<ArtifactApprovalBarParams>();

    const { trigger: approve, isMutating: isApproving } = useApproveProjectArtifactVersion(
        projectId,
        artifactKey,
        artifactVersion,
    );
    const { trigger: reject, isMutating: isRejecting } = useRejectProjectArtifactVersion(
        projectId,
        artifactKey,
        artifactVersion,
    );

    const isProcessing = isApproving || isRejecting;

    // Check if there are other pending artifacts (excluding the current one)
    const hasOtherPendingArtifacts = () => {
        return Object.values(artifacts).some((versions) =>
            Object.values(versions).some(
                (artifact) => artifact.key !== artifactKey && artifact.proposed_version?.status === 'proposed',
            ),
        );
    };

    const handleApprove = async () => {
        try {
            onProcessingChange?.(true);
            const updated = await approve();
            if (updated) {
                // artifactId received in prop comes from panel state, we set key as id everywhere in app, because we don't have id yet when artifact is streamed
                // @TODO: cleanup and refactor key/id + unify db/frontend source of truth
                updateArtifact(artifactId, { ...updated, id: artifactKey }, artifactVersion, { merge: false });
                // Clear pending changes only if no other artifacts are pending
                if (!hasOtherPendingArtifacts()) {
                    clearPendingChanges();
                }
            }
        } catch (err) {
            console.error('Failed to approve:', err);
        } finally {
            onProcessingChange?.(false);
        }
    };

    const handleReject = async () => {
        try {
            onProcessingChange?.(true);
            // TODO: Remove the need for the reason
            const updated = await reject('rejected');
            if (updated) {
                // artifactId received in prop comes from panel state, we set key as id everywhere in app, because we don't have id yet when artifact is streamed
                // @TODO: cleanup and refactor key/id + unify db/frontend source of truth
                updateArtifact(artifactId, { ...updated, id: artifactKey }, artifactVersion, { merge: false });
                // Clear pending changes only if no other artifacts are pending
                if (!hasOtherPendingArtifacts()) {
                    clearPendingChanges();
                }
            }
        } catch (err) {
            console.error('Failed to reject:', err);
        } finally {
            onProcessingChange?.(false);
        }
    };

    return (
        <div className="border-t border-border px-4 pt-4 pb-6 space-y-2.5">
            <p className="text-xs text-muted-foreground text-center">This document is awaiting your approval</p>
            <div className="flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={handleReject} disabled={isProcessing}>
                    {isRejecting ? <Loader2 className="size-3 animate-spin mr-1" /> : <XIcon className="size-3 mr-1" />}
                    Reject
                </Button>
                <Button size="sm" onClick={handleApprove} disabled={isProcessing}>
                    {isApproving ? <Loader2 className="size-3 animate-spin mr-1" /> : <Check className="size-3 mr-1" />}
                    Approve
                </Button>
            </div>
        </div>
    );
}
