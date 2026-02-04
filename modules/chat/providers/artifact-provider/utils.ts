import { Artifact } from '@/modules/chat/types';

export const getArtifactVersion = (artifact: Artifact) => {
    return artifact.proposed_version ?? artifact.current_version;
};

export const getArtifactContent = (artifact: Artifact) => {
    return getArtifactVersion(artifact)?.content ?? '';
};