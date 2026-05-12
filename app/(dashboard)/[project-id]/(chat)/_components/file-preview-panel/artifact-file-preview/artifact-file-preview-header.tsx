'use client';

import { useAuth } from '@clerk/nextjs';
import { Download, Loader2, Trash2, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { IconButton } from '@/components/ui/icon-button';
import { ImageThumbnail } from '@/components/ui/image-thumbnail';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { projectResourceKeys } from '@/lib/api/client/fetchers/project-resources';
import { deleteArtifact } from '@/lib/api/requests/worker/chat';
import type { DocumentType } from '@/lib/schema/artifact';
import { downloadBlob } from '@/lib/utils';
import { getDocumentTypeIcon } from '@/modules/artifacts/utils';

type ArtifactFilePreviewHeaderProps = {
    title: string;
    documentType?: DocumentType;
    artifactId: string;
    fileName?: string;
    fileId?: string;
    mimeType?: string;
    fileUrl?: string | null;
    content?: string | null;
    isUploaded?: boolean;
    onClose: () => void;
};

export function ArtifactFilePreviewHeader({
    title,
    documentType,
    artifactId,
    fileName,
    fileId,
    mimeType,
    fileUrl,
    content,
    isUploaded,
    onClose,
}: ArtifactFilePreviewHeaderProps) {
    const { getToken } = useAuth();
    const { 'project-id': projectId } = useParams<{ 'project-id': string }>();
    const { mutate: globalMutate } = useSWRConfig();
    const [isDeleting, setIsDeleting] = useState(false);

    const canDownload = !!(fileUrl || content);
    const canDelete = !!isUploaded;

    const handleDownload = useCallback(async () => {
        if (fileUrl && fileName) {
            const res = await fetch(fileUrl);
            const blob = await res.blob();
            downloadBlob(blob, fileName);
        } else if (content) {
            const blob = new Blob([content], { type: 'text/markdown' });
            downloadBlob(blob, fileName ?? 'document.md');
        }
    }, [fileUrl, fileName, content]);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            const token = await getToken();
            if (token) await deleteArtifact({ artifactId }, token);
            if (projectId) {
                globalMutate(
                    (key) =>
                        Array.isArray(key) && key[0] === projectResourceKeys.all(projectId)[0] && key[1] === projectId,
                );
            }
            onClose();
        } catch (err) {
            console.error('[FilePreview] Delete failed:', err);
        } finally {
            setIsDeleting(false);
        }
    }, [artifactId, getToken, projectId, globalMutate, onClose]);

    return (
        <div className="flex items-center justify-between gap-2 h-14 px-4 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
                <HeaderIcon fileName={fileName} fileId={fileId} mimeType={mimeType} documentType={documentType} />
                <span title={title} className="line-clamp-1 text-sm font-medium">
                    {title}
                </span>
            </div>

            <div className="flex items-center gap-0.5">
                {canDownload && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <IconButton size="sm" onClick={handleDownload}>
                                <Download />
                            </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>Download</TooltipContent>
                    </Tooltip>
                )}
                {canDelete && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <IconButton size="sm" onClick={handleDelete} disabled={isDeleting}>
                                {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                            </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                )}
                <IconButton size="sm" onClick={onClose}>
                    <X />
                </IconButton>
            </div>
        </div>
    );
}

type HeaderIconProps = {
    fileName?: string;
    fileId?: string;
    mimeType?: string;
    documentType?: DocumentType;
};

function HeaderIcon({ fileName, fileId, mimeType, documentType }: HeaderIconProps) {
    if (fileId && mimeType?.startsWith('image/')) {
        return <ImageThumbnail fileId={fileId} />;
    }

    if (fileName) {
        return <FileTypeIcon filename={fileName} size={20} className="shrink-0" />;
    }

    const Icon = getDocumentTypeIcon(documentType);
    return <Icon className="size-5 shrink-0 text-neutral-500" />;
}
