import type { PresignUploadResponseDto } from '@/lib/schema/artifact';

export type FileEntryStatus = 'pending' | 'uploading' | 'processing' | 'ready';

export type FileEntry = {
    id: string;
    name: string;
    size: number;
    status: FileEntryStatus;
    createdAt: number;
    file?: File;
    artifactId?: string;
    /** True when the artifact was uploaded before a chat/project scope existed and must be associated on send. */
    requiresAssociation?: boolean;
    fileId?: string;
    presignData?: PresignUploadResponseDto;
    /** Set when the upload is a chat image (not an artifact). */
    imageFileId?: string;
    /** Natural dimensions of an uploaded image (resolved from the File blob). */
    imageWidth?: number;
    imageHeight?: number;
};
