'use client';

import { Check, Copy, Download, FileText, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ArtifactHeaderProps = {
    title: string;
    content: string;
    onCloseAction: () => void;
};

export function ArtifactHeader({ title, content, onCloseAction }: ArtifactHeaderProps) {
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
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{title}</span>
            </div>

            <div className="flex items-center gap-1">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={handleCopy}>
                            {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{copied ? 'Copied!' : 'Copy content'}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={handleDownload}>
                            {downloaded ? <Check className="size-4 text-green-500" /> : <Download className="size-4" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{downloaded ? 'Downloaded!' : 'Download'}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={onCloseAction}>
                            <X className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Close</TooltipContent>
                </Tooltip>
            </div>
        </div>
    );
}
