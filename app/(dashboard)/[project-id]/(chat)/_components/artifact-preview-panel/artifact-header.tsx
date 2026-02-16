'use client';

import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Check, Copy, Download, FileText, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { VersionStatus } from '@/lib/schema/artifact';
import { VersionStatusBadge } from '../version-status-badge';

type ArtifactHeaderProps = {
    title: string;
    content: string;
    version?: number;
    status?: VersionStatus;
    isUploaded?: boolean;
    backHref?: string;
    updatedAt?: Date;
    onCloseAction?: () => void;
    /** Slot for extra action buttons (e.g. delete) rendered before the close button */
    actions?: ReactNode;
};

export function ArtifactHeader({
    title,
    content,
    version,
    status,
    isUploaded,
    backHref,
    updatedAt,
    onCloseAction,
    actions,
}: ArtifactHeaderProps) {
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);

    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : undefined;

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
                    <FileText className="size-5 shrink-0 text-neutral-500 mt-0.5" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="line-clamp-1 text-sm font-medium">{title}</span>
                            <VersionStatusBadge status={status} isUploaded={isUploaded} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                            <span>v{version}</span>
                            {timeAgo && (
                                <>
                                    <span>·</span>
                                    <span>{timeAgo}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-1">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={handleCopy} disabled={!content}>
                            {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{copied ? 'Copied!' : 'Copy content'}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={handleDownload} disabled={!content}>
                            {downloaded ? <Check className="size-4 text-green-500" /> : <Download className="size-4" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{downloaded ? 'Downloaded!' : 'Download'}</TooltipContent>
                </Tooltip>

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
