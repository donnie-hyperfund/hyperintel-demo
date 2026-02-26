import type { DocumentType } from '@/lib/schema/artifact';
import type { Artifact } from '@/modules/chat/types';
import { DEFAULT_DOCUMENT_TYPE_ICON, DOCUMENT_TYPE_ICONS } from './constants';

export const getArtifactVersion = (artifact: Artifact) => {
    return artifact.proposed_version ?? artifact.current_version;
};

export const getArtifactContent = (artifact: Artifact) => {
    return getArtifactVersion(artifact)?.content ?? '';
};

export const getArtifactChatId = (artifact: Artifact): string | null => {
    const chat = getArtifactVersion(artifact)?.chat;
    return typeof chat === 'string' ? chat : null;
};

export function getDocumentTypeIcon(documentType?: DocumentType) {
    return (documentType && DOCUMENT_TYPE_ICONS[documentType]) ?? DEFAULT_DOCUMENT_TYPE_ICON;
}
