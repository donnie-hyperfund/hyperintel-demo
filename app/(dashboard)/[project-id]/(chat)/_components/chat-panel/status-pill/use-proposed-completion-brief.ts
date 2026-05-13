import { useArtifactStore } from '@/modules/artifacts/providers/artifact-provider';

type ProposedCompletionBrief = {
    versionNumber: number;
    versionId: string;
};

export function useProposedCompletionBrief(completionBriefKey: string): ProposedCompletionBrief | null {
    const store = useArtifactStore();
    const slots = store[completionBriefKey];
    if (!slots) return null;

    for (const artifact of Object.values(slots)) {
        const proposed = artifact.proposedVersion;
        if (proposed?.status === 'proposed' && proposed.version !== undefined && proposed.id) {
            return { versionNumber: proposed.version, versionId: proposed.id };
        }
    }
    return null;
}
