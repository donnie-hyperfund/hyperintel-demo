import { useArtifactStore } from '@/modules/artifacts/providers/artifact-provider';

type ProposedCompletionBrief = {
    artifactId: string;
    artifactKey: string;
    versionNumber: number;
    versionId: string;
};

export function useProposedCompletionBrief(completionBriefKey: string): ProposedCompletionBrief | null {
    const store = useArtifactStore();
    for (const versions of Object.values(store)) {
        for (const artifact of Object.values(versions)) {
            if (artifact.key !== completionBriefKey) continue;
            const proposed = artifact.proposedVersion;
            if (proposed?.status === 'proposed' && proposed.version !== undefined && proposed.id) {
                return {
                    artifactId: artifact.id,
                    artifactKey: artifact.key,
                    versionNumber: proposed.version,
                    versionId: proposed.id,
                };
            }
        }
    }
    return null;
}
