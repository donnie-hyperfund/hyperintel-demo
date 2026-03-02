import { DOCUMENT_TYPES, type DocumentType } from '@/lib/schema/artifact';
import type { Artifact } from '@/modules/chat/types';
import { DEFAULT_DOCUMENT_TYPE_ICON, DOCUMENT_TYPE_ICONS } from './constants';

export const getLatestArtifactVersion = (artifact: Artifact) => {
    return artifact.proposed_version ?? artifact.current_version;
};

export const getLatestArtifactContent = (artifact: Artifact) => {
    return getLatestArtifactVersion(artifact)?.content ?? '';
};

export const getArtifactChatId = (artifact: Artifact): string | null => {
    const chat = getLatestArtifactVersion(artifact)?.chat;
    return typeof chat === 'string' ? chat : null;
};

export function getDocumentTypeIcon(documentType?: DocumentType) {
    return (documentType && DOCUMENT_TYPE_ICONS[documentType]) ?? DEFAULT_DOCUMENT_TYPE_ICON;
}

export function isDocumentType(documentType: string): documentType is DocumentType {
    return DOCUMENT_TYPES.includes(documentType as DocumentType);
}
