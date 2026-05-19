import { getCompletionBriefKey } from '@/lib/artifacts/utils';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useProposedCompletionBrief } from './use-proposed-completion-brief';

export function useIsCompletionBriefReviewSuppressed(phaseIndex: number | null): boolean {
    const completionBriefKey = getCompletionBriefKey((phaseIndex ?? 0) + 1);
    const { panelState } = useActivePanelContext();
    const { visibleEntries } = useArtifactProcessing();
    const proposedCompletionBrief = useProposedCompletionBrief(completionBriefKey);

    if (!proposedCompletionBrief) return false;

    const isReviewingProposedCompletionBrief =
        panelState?.panel === 'artifact-preview' &&
        panelState.artifactKey === completionBriefKey &&
        panelState.version === proposedCompletionBrief.versionNumber;

    const isApprovingOrRejectingProposedCompletionBrief = visibleEntries.some(
        (entry) =>
            entry.versionId === proposedCompletionBrief.versionId &&
            (entry.action === 'approve' || entry.action === 'reject') &&
            entry.status !== 'failed',
    );

    return isReviewingProposedCompletionBrief || isApprovingOrRejectingProposedCompletionBrief;
}
