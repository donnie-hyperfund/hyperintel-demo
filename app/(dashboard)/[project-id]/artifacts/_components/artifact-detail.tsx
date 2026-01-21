'use client';

import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Check, Copy, Download, FileText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ArtifactDto } from '@/lib/schema/artifact';

type ArtifactDetailProps = {
    artifact: ArtifactDto;
    projectId: string;
};

export const ArtifactDetail = ({ artifact, projectId }: ArtifactDetailProps) => {
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);

    const content = artifact.current_version?.content ?? '';
    const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;

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
        a.download = artifact.title.endsWith('.md') ? artifact.title : `${artifact.title}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 1000);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
                <div className="flex items-center gap-3 min-w-0">
                    <Button variant="ghost" size="icon-sm" asChild>
                        <Link href={`/${projectId}/artifacts`}>
                            <ArrowLeft className="size-4" />
                        </Link>
                    </Button>
                    <FileText className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                        <h1 className="text-lg font-semibold truncate">{artifact.title}</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>v{artifact.version}</span>
                            {timeAgo && (
                                <>
                                    <span>·</span>
                                    <span>Updated {timeAgo}</span>
                                </>
                            )}
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
                                {downloaded ? (
                                    <Check className="size-4 text-green-500" />
                                ) : (
                                    <Download className="size-4" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{downloaded ? 'Downloaded!' : 'Download'}</TooltipContent>
                    </Tooltip>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {content ? (
                    <div className="mx-auto max-w-4xl">
                        <MarkdownRenderer markdown={content} variant="document" />
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>No content available</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export const ArtifactDetailSkeleton = () => {
    return (
        <div className="flex flex-col h-full">
            {/* Header skeleton */}
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
                <div className="flex items-center gap-3">
                    <Skeleton className="size-8" />
                    <Skeleton className="size-5" />
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-3 w-32" />
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Skeleton className="size-8" />
                    <Skeleton className="size-8" />
                </div>
            </div>

            {/* Content skeleton */}
            <div className="flex-1 p-6">
                <div className="mx-auto max-w-4xl space-y-4">
                    <Skeleton className="h-8 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                </div>
            </div>
        </div>
    );
};
