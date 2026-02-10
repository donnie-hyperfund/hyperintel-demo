'use client';

import { useAuth } from '@clerk/nextjs';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Check, Copy, Download, FileText, Loader2, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { uploadArtifact } from '@/lib/api/requests/worker/chat';
import type { VersionStatus } from '@/lib/schema/artifact';
import { ALLOWED_ARTIFACT_EXTENSIONS, MAX_ARTIFACT_UPLOAD_SIZE } from '@/lib/schema/artifact';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { VersionStatusBadge } from '../version-status-badge';

type ArtifactHeaderProps = {
    title: string;
    content: string;
    version?: number;
    status?: VersionStatus;
    backHref?: string;
    updatedAt?: Date;
    onCloseAction?: () => void;
};

export function ArtifactHeader({
    title,
    content,
    version,
    status,
    backHref,
    updatedAt,
    onCloseAction,
}: ArtifactHeaderProps) {
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { getToken } = useAuth();
    const { chatId } = useChatContext();
    // TODO expose projectId
    const params = useParams();
    const projectId = params?.['project-id'] as string;

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

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_ARTIFACT_UPLOAD_SIZE) {
            // TODO proper formatting of size
            toast.error(`File too large (max ${MAX_ARTIFACT_UPLOAD_SIZE / 1024 / 1024}MB)`);
            return;
        }

        const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        if (!ALLOWED_ARTIFACT_EXTENSIONS.includes(ext)) {
            toast.error(`Unsupported file type '${ext}'. Allowed: ${ALLOWED_ARTIFACT_EXTENSIONS.join(', ')}`);
            return;
        }

        setIsUploading(true);
        try {
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');
            if (!chatId) throw new Error('No active chat');

            const res = await uploadArtifact({ file, projectId, chatId }, token);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Upload failed');
            }

            const result = await res.json();
            toast.success(
                result.action === 'new_version'
                    ? `Uploaded as v${result.version} of "${result.key}"`
                    : `Uploaded "${result.key}"`,
            );
        } catch (err) {
            console.error('Upload failed:', err);
            toast.error(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="flex items-center justify-between gap-2 h-14 px-4 border-b border-border">
            <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_ARTIFACT_EXTENSIONS.join(',')}
                onChange={handleUpload}
                className="hidden"
            />

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
                            {status && <VersionStatusBadge status={status} />}
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
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading || !chatId}
                        >
                            {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{isUploading ? 'Uploading...' : 'Upload to knowledgebase'}</TooltipContent>
                </Tooltip>

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
