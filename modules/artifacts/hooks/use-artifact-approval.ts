import { toast } from '@/hooks/use-toast';
import { useFetchChat } from '@/lib/api/client/hooks/use-chats';
import {
    useApproveProjectArtifactVersion,
    useRejectProjectArtifactVersion,
} from '@/lib/api/client/hooks/use-project-artifacts';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';

type UseArtifactApprovalOptions = {
    artifactId: string;
    artifactKey: string;
    version: number;
    artifactVersionId: string;
    /** Label used in error toasts — e.g. "document" or "workflow item" */
    entityLabel?: string;
    disabled?: boolean;
    onProcessingChange?: (isProcessing: boolean) => void;
};

export function useArtifactApproval({
    artifactId,
    artifactKey,
    version,
    artifactVersionId,
    entityLabel = 'document',
    disabled = false,
    onProcessingChange,
}: UseArtifactApprovalOptions) {
    const { updateArtifact } = useArtifactActions();
    const chatContext = useChatContext();
    const { clearPendingChanges, chatType, chatId, hasOtherPendingArtifacts, setProcessingArtifactAction, state } =
        chatContext;
    const { isLinking: isLinkingToProject, isProjectFlow, handleApprovedArtifact } = useOptionalProjectOrigin();
    const { startProcessing, failProcessing } = useArtifactProcessing();
    const isIntake = chatType !== 'phase';
    const projectId = chatContext.chatType === 'phase' ? chatContext.projectId : undefined;
    const { data: project } = useFetchProject(projectId);
    const { data: chat } = useFetchChat(projectId, chatId ?? undefined);

    const { trigger: approveRequest, isMutating: isApproving } = useApproveProjectArtifactVersion(
        projectId,
        artifactKey,
        version,
        artifactVersionId,
    );
    const { trigger: rejectRequest, isMutating: isRejecting } = useRejectProjectArtifactVersion(
        projectId,
        artifactKey,
        version,
        artifactVersionId,
    );

    const isProcessing = isApproving || isRejecting || isLinkingToProject || disabled;

    const registerProcessing = (action: 'approve' | 'reject') => {
        startProcessing({
            versionId: artifactVersionId,
            artifactId,
            artifactName: artifactKey,
            artifactVersion: version,
            action,
            projectId,
            projectName: project?.name,
            phaseName: chat?.name ?? undefined,
            phaseIndex: state.phaseIndex ?? undefined,
            chatId: chatId ?? undefined,
            progress: action === 'approve' ? 4 : undefined,
            stage: action === 'approve' ? 'queued' : undefined,
        });
    };

    const approve = async () => {
        try {
            onProcessingChange?.(true);
            setProcessingArtifactAction(true);
            registerProcessing('approve');
            const updated = await approveRequest();

            if (updated) {
                updateArtifact(artifactId, updated, version, { merge: false });
                if (!hasOtherPendingArtifacts(artifactKey)) {
                    clearPendingChanges();
                }

                if (isIntake && isProjectFlow) {
                    await handleApprovedArtifact(updated);
                }
            }
        } catch (err) {
            console.error('Failed to approve:', err);
            failProcessing(artifactVersionId);
            toast({ title: `Failed to approve ${entityLabel}.`, variant: 'destructive' });
        } finally {
            onProcessingChange?.(false);
            setProcessingArtifactAction(false);
        }
    };

    const reject = async () => {
        try {
            onProcessingChange?.(true);
            setProcessingArtifactAction(true);
            registerProcessing('reject');
            const updated = await rejectRequest('rejected');

            if (updated) {
                updateArtifact(artifactId, updated, version, { merge: false });
                if (!hasOtherPendingArtifacts(artifactKey)) {
                    clearPendingChanges();
                }
            }
        } catch (err) {
            console.error('Failed to reject:', err);
            failProcessing(artifactVersionId);
            toast({ title: `Failed to reject ${entityLabel}.`, variant: 'destructive' });
        } finally {
            onProcessingChange?.(false);
            setProcessingArtifactAction(false);
        }
    };

    return { approve, reject, isApproving, isRejecting, isProcessing };
}
