import type { ApprovalAction, ApprovalProcessingEntry, ProcessingEntry } from '@/modules/artifacts/processing/types';

export type ArtifactOverlayState =
    | { kind: 'delete' }
    | { kind: 'link' }
    | { kind: 'updating' }
    | { kind: 'approval'; action: ApprovalAction; entry?: ApprovalProcessingEntry }
    | null;

type UseArtifactOverlayStateOptions = {
    isProcessingDelete: boolean;
    isLinkingToProject: boolean;
    processingAction: ApprovalAction | null;
    processingEntry: ProcessingEntry | undefined;
    isUpdating: boolean;
    isSummaryStreaming: boolean;
};

export function useArtifactOverlayState({
    isProcessingDelete,
    isLinkingToProject,
    processingAction,
    processingEntry,
    isUpdating,
    isSummaryStreaming,
}: UseArtifactOverlayStateOptions): ArtifactOverlayState {
    if (isProcessingDelete) return { kind: 'delete' };
    if (isLinkingToProject) return { kind: 'link' };

    const approvalEntry =
        processingEntry?.action === 'approve' || processingEntry?.action === 'reject' ? processingEntry : undefined;
    const isApprovalInFlight =
        !!approvalEntry && (approvalEntry.status === 'processing' || approvalEntry.status === 'completed');

    if (isApprovalInFlight) {
        return { kind: 'approval', action: approvalEntry.action, entry: approvalEntry };
    }
    if (processingAction) {
        return { kind: 'approval', action: processingAction };
    }

    if (isUpdating && !isSummaryStreaming) return { kind: 'updating' };
    return null;
}
