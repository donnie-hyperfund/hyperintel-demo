'use client';

import { Check, Loader2, X as XIcon } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useApproveUserArtifactVersion, useRejectUserArtifactVersion } from '@/lib/api/client/hooks/use-artifacts';
import {
    useApproveProjectArtifactVersion,
    useRejectProjectArtifactVersion,
} from '@/lib/api/client/hooks/use-project-artifacts';
import { useArtifactContext } from '@/modules/artifacts/providers/artifact-provider';
import { isIntakeChat } from '@/modules/artifacts/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';

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
    const { clearPendingChanges, chatType } = useChatContext();
    const { isLinking: isLinkingToProject, isProjectFlow, handleApprovedArtifact } = useOptionalProjectOrigin();
    const isIntake = isIntakeChat(chatType);

    const { 'project-id': projectId } = useParams<ArtifactApprovalBarParams>();

    // Project-scoped hooks (only triggered for phase chats)
    const { trigger: approveProjectArtifact, isMutating: isApprovingProjectArtifact } =
        useApproveProjectArtifactVersion(projectId, artifactKey, artifactVersion);
    const { trigger: rejectProjectArtifact, isMutating: isRejectingProjectArtifact } = useRejectProjectArtifactVersion(
        projectId,
        artifactKey,
        artifactVersion,
    );

    // User-scoped hooks (only triggered for intake chats)
    const { trigger: approveUserArtifact, isMutating: isApprovingUserArtifact } = useApproveUserArtifactVersion(
        artifactKey,
        artifactVersion,
    );
    const { trigger: rejectUserArtifact, isMutating: isRejectingUserArtifact } = useRejectUserArtifactVersion(
        artifactKey,
        artifactVersion,
    );

    const isApproving = isApprovingProjectArtifact || isApprovingUserArtifact;
    const isRejecting = isRejectingProjectArtifact || isRejectingUserArtifact;
    const isProcessing = isApproving || isRejecting || isLinkingToProject;

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
            const updated = isIntake ? await approveUserArtifact() : await approveProjectArtifact();

            if (updated) {
                updateArtifact(artifactId, updated, artifactVersion, { merge: false });
                // Clear pending changes only if no other artifacts are pending
                if (!hasOtherPendingArtifacts()) {
                    clearPendingChanges();
                }

                if (isIntake && isProjectFlow) {
                    await handleApprovedArtifact(updated);
                }
            }
        } catch (err) {
            console.error('Failed to approve:', err);
            toast({ title: 'Failed to approve document.', variant: 'destructive' });
        } finally {
            onProcessingChange?.(false);
        }
    };

    const handleReject = async () => {
        try {
            onProcessingChange?.(true);
            // TODO: Remove the need for the reason
            const updated = isIntake ? await rejectUserArtifact('rejected') : await rejectProjectArtifact('rejected');
            if (updated) {
                updateArtifact(artifactId, updated, artifactVersion, { merge: false });
                // Clear pending changes only if no other artifacts are pending
                if (!hasOtherPendingArtifacts()) {
                    clearPendingChanges();
                }
            }
        } catch (err) {
            console.error('Failed to reject:', err);
            toast({ title: 'Failed to reject document.', variant: 'destructive' });
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
