'use client';

import { ArrowLeft, Check, Copy, Download, FileText, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ArtifactHeaderProps = {
    title: string;
    content: string;
    /** Version number to display */
    version?: number;
    /** Subtitle text (e.g., "Updated 2 hours ago") */
    subtitle?: string;
    /** Back link URL - shows back arrow instead of close button */
    backHref?: string;
    /** Close handler - shows X button (ignored if backHref is set) */
    onCloseAction?: () => void;
};

export function ArtifactHeader({ title, content, version, subtitle, backHref, onCloseAction }: ArtifactHeaderProps) {
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);

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
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
                {backHref && (
                    <Button variant="ghost" size="icon-sm" asChild>
                        <Link href={backHref}>
                            <ArrowLeft className="size-4" />
                        </Link>
                    </Button>
                )}
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                    <span className="text-sm font-medium truncate block">{title}</span>
                    {(version !== undefined || subtitle) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {version !== undefined && <span>v{version}</span>}
                            {version !== undefined && subtitle && <span>·</span>}
                            {subtitle && <span>{subtitle}</span>}
                        </div>
                    )}
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
