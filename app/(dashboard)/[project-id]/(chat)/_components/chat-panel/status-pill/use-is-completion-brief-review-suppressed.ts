import { getCompletionBriefKey } from '@/lib/artifacts/utils';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

export function useIsCompletionBriefReviewSuppressed(phaseIndex: number | null): boolean {
    const completionBriefKey = getCompletionBriefKey((phaseIndex ?? 0) + 1);
    const { panelState } = useActivePanelContext();
    const { visibleEntries } = useArtifactProcessing();

    const isReviewingCompletionBrief =
        panelState?.panel === 'artifact-preview' && panelState.artifactId === completionBriefKey;

    const isApprovingOrRejectingCompletionBrief = visibleEntries.some(
        (entry) =>
            entry.artifactId === completionBriefKey &&
            (entry.action === 'approve' || entry.action === 'reject') &&
            entry.status !== 'failed',
    );

    return isReviewingCompletionBrief || isApprovingOrRejectingCompletionBrief;
}
