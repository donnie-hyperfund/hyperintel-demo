'use client';

import { useAuth } from '@clerk/nextjs';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { ArrowLeft, Check, Copy, Download, FileUp, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VersionStatusBadge } from '@/components/ui/version-status-badge';
import { exportArtifact } from '@/lib/api/requests/worker/chat';
import { isIntakeDocument } from '@/lib/artifacts/utils';
import type { DocumentType, VersionStatus } from '@/lib/schema/artifact';
import { getDocumentTypeIcon } from '@/modules/artifacts/utils';

type ArtifactHeaderProps = {
    title: string;
    content: string;
    version?: number;
    status?: VersionStatus;
    documentType?: DocumentType;
    isUploaded?: boolean;
    isInternal?: boolean;
    artifactVersionId?: string;
    backHref?: string;
    updatedAt?: Date;
    onCloseAction?: () => void;
    /** Slot for extra action buttons (e.g. version history, delete) rendered before the close button */
    actions?: ReactNode;
    /** Whether the content is being streamed */
    isStreaming?: boolean;
};

export function ArtifactHeader({
    title,
    content,
    version,
    status,
    documentType,
    isUploaded,
    isInternal,
    artifactVersionId,
    backHref,
    updatedAt,
    onCloseAction,
    actions,
    isStreaming,
}: ArtifactHeaderProps) {
    const { getToken } = useAuth();
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);
    const [exporting, setExporting] = useState(false);

    const Icon = getDocumentTypeIcon(documentType);
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : undefined;
    const updatedAtFormatted = updatedAt ? format(updatedAt, 'PPP HH:mm', { locale: enUS }) : undefined;
    const canExportDocx = !isInternal && !!artifactVersionId && !!content;

    const shouldDisplayVersion = !isIntakeDocument(documentType);
    const shouldDisplayCopyButton = !!content && !isStreaming;
    const shouldDisplayDownloadButton = !!content && !isStreaming;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
    };

    const handleDownload = () => {
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = title.endsWith('.md') ? title : `${title}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 1000);
    };

    const handleExportDocx = async () => {
        if (!artifactVersionId) return;
        setExporting(true);
        try {
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const res = await exportArtifact(artifactVersionId, token);
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: 'Export failed' }));
                throw new Error(err.message ?? 'Export failed');
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title.replace(/\.md$/, '')}.docx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[exportDocx] Failed:', err);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="flex items-center justify-between gap-2 h-14 px-4 border-b border-border">
            <div className="flex items-center gap-2.5 min-w-0">
                {backHref && (
                    <Button variant="ghost" size="icon-sm" asChild>
                        <Link href={backHref}>
                            <ArrowLeft className="size-4" />
                        </Link>
                    </Button>
                )}
                <div className="flex gap-3 items-center">
                    <Icon className="size-5 shrink-0 text-neutral-500 mt-0.5" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span title={title} className="line-clamp-1 text-sm font-medium">
                                {title}
                            </span>
                            {shouldDisplayVersion && <VersionStatusBadge status={status} isUploaded={isUploaded} />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                            {shouldDisplayVersion && <span>v{version}</span>}
                            {timeAgo && updatedAtFormatted && (
                                <>
                                    {shouldDisplayVersion && <span>·</span>}
                                    <span title={updatedAtFormatted}>{timeAgo}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-1">
                {shouldDisplayCopyButton && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={handleCopy} disabled={!content}>
                                {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{copied ? 'Copied!' : 'Copy content'}</TooltipContent>
                    </Tooltip>
                )}

                {shouldDisplayDownloadButton && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={handleDownload} disabled={!content}>
                                {downloaded ? (
                                    <Check className="size-4 text-green-500" />
                                ) : (
                                    <Download className="size-4" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{downloaded ? 'Downloaded!' : 'Download'}</TooltipContent>
                    </Tooltip>
                )}

                {canExportDocx && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={handleExportDocx} disabled={exporting}>
                                {exporting ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <FileUp className="size-4" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{exporting ? 'Exporting...' : 'Export to DOCX'}</TooltipContent>
                    </Tooltip>
                )}

                {actions}

                {!backHref && onCloseAction && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={onCloseAction}>
                                <X className="size-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Close</TooltipContent>
                    </Tooltip>
                )}
            </div>
        </div>
    );
}
