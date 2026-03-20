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
    fileId?: string;
    presignData?: PresignUploadResponseDto;
};
