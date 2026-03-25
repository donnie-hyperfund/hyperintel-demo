'use client';

import { Check, Loader2, X as XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
    useApproveProjectArtifactVersion,
    useRejectProjectArtifactVersion,
} from '@/lib/api/client/hooks/use-project-artifacts';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';

type ArtifactApprovalBarProps = {
    artifactId: string;
    artifactKey: string;
    artifactVersion: number;
    artifactVersionId: string;
    isInternal?: boolean;
    disabled?: boolean;
    onProcessingChange?: (isProcessing: boolean) => void;
};

export function ArtifactApprovalBar({
    artifactId,
    artifactKey,
    artifactVersion,
    artifactVersionId,
    isInternal = false,
    disabled = false,
    onProcessingChange,
}: ArtifactApprovalBarProps) {
    const { updateArtifact } = useArtifactActions();
    const { clearPendingChanges, chatType, hasOtherPendingArtifacts, sendNudge, setProcessingArtifactAction } =
        useChatContext();
    const { isLinking: isLinkingToProject, isProjectFlow, handleApprovedArtifact } = useOptionalProjectOrigin();
    const isIntake = chatType !== 'phase';

    const chatContext = useChatContext();
    const projectId = chatContext.chatType === 'phase' ? chatContext.projectId : undefined;

    const { trigger: approve, isMutating: isApproving } = useApproveProjectArtifactVersion(
        projectId,
        artifactKey,
        artifactVersion,
        artifactVersionId,
    );
    const { trigger: reject, isMutating: isRejecting } = useRejectProjectArtifactVersion(
        projectId,
        artifactKey,
        artifactVersion,
        artifactVersionId,
    );

    const isProcessing = isApproving || isRejecting || isLinkingToProject || disabled;

    const handleApprove = async () => {
        try {
            onProcessingChange?.(true);
            setProcessingArtifactAction(true);
            const updated = await approve();

            if (updated) {
                updateArtifact(artifactId, updated, artifactVersion, { merge: false });
                // Clear pending changes only if no other artifacts are pending
                if (!hasOtherPendingArtifacts(artifactKey)) {
                    clearPendingChanges();
                }

                if (isIntake && isProjectFlow) {
                    await handleApprovedArtifact(updated);
                }

                // Nudge the agent to react to the approval (system event already injected by backend)
                await sendNudge();
            }
        } catch (err) {
            console.error('Failed to approve:', err);
            toast({ title: 'Failed to approve document.', variant: 'destructive' });
        } finally {
            onProcessingChange?.(false);
            setProcessingArtifactAction(false);
        }
    };

    const handleReject = async () => {
        try {
            onProcessingChange?.(true);
            setProcessingArtifactAction(true);
            const updated = await reject('rejected');
            if (updated) {
                updateArtifact(artifactId, updated, artifactVersion, { merge: false });
                // Clear pending changes only if no other artifacts are pending
                if (!hasOtherPendingArtifacts(artifactKey)) {
                    clearPendingChanges();
                }
            }
        } catch (err) {
            console.error('Failed to reject:', err);
            toast({ title: 'Failed to reject document.', variant: 'destructive' });
        } finally {
            onProcessingChange?.(false);
            setProcessingArtifactAction(false);
        }
    };

    return (
        <div className="border-t border-border px-4 pt-4 pb-6 space-y-2.5">
            <p className="text-xs text-muted-foreground text-center">
                {isInternal
                    ? 'This workflow item is ready for confirmation.'
                    : 'This document is awaiting your approval'}
            </p>
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
