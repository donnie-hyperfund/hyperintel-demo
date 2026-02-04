import { Artifact } from '@/modules/chat/types';

export const getArtifactVersion = (artifact: Artifact) => {
    return artifact.proposed_version ?? artifact.current_version;
};

export const getLatestApprovedArtifactVersion = (artifact: Artifact) => {
    return artifact.proposed_version?.status === 'approved' ? artifact.proposed_version : artifact.current_version;
};

export const getArtifactContent = (artifact: Artifact) => {
    return getArtifactVersion(artifact)?.content ?? '';
};

export const getLatestApprovedArtifactContent = (artifact: Artifact) => {
    return getLatestApprovedArtifactVersion(artifact)?.content ?? '';
};
