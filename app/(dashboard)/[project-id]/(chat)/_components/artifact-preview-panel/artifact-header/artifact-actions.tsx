'use client';

import { useAuth } from '@clerk/nextjs';
import { Check, Copy, Download, FileUp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useClipboardAction } from '@/hooks/use-clipboard-action';
import { exportArtifact } from '@/lib/api/requests/worker/chat';
import { downloadBlob } from '@/lib/utils';
import type { ActionType } from './header-action';
import { HeaderAction } from './header-action';

type ArtifactActionsProps = {
    type: ActionType;
    title: string;
    content: string;
    isInternal?: boolean;
    artifactVersionId?: string;
    isStreaming?: boolean;
};

export function ArtifactActions({
    type,
    title,
    content,
    isInternal,
    artifactVersionId,
    isStreaming,
}: ArtifactActionsProps) {
    const { getToken } = useAuth();
    const { isCopied, copy } = useClipboardAction();
    const [isDownloaded, setIsDownloaded] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const canExportDocx = !isInternal && !!artifactVersionId && !!content;
    const showContentActions = !!content && !isStreaming;

    if (!showContentActions && !canExportDocx) return null;

    const handleDownload = () => {
        const blob = new Blob([content], { type: 'text/markdown' });
        downloadBlob(blob, title.endsWith('.md') ? title : `${title}.md`);
        setIsDownloaded(true);
        setTimeout(() => setIsDownloaded(false), 2000);
    };

    const handleExportDocx = async () => {
        if (!artifactVersionId) return;
        setIsExporting(true);
        try {
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');
            const res = await exportArtifact(artifactVersionId, token);
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: 'Export failed' }));
                throw new Error(err.message ?? 'Export failed');
            }
            const blob = await res.blob();
            downloadBlob(blob, `${title.replace(/\.md$/, '')}.docx`);
        } catch (err) {
            console.error('[exportDocx] Failed:', err);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <>
            {showContentActions && (
                <>
                    <HeaderAction
                        type={type}
                        icon={isCopied ? Check : Copy}
                        iconClassName={isCopied ? 'size-4 text-green-500' : undefined}
                        label={isCopied ? 'Copied!' : 'Copy content'}
                        onClick={() => copy(content)}
                        disabled={!content}
                    />
                    <HeaderAction
                        type={type}
                        icon={isDownloaded ? Check : Download}
                        iconClassName={isDownloaded ? 'size-4 text-green-500' : undefined}
                        label={isDownloaded ? 'Downloaded!' : 'Download'}
                        onClick={handleDownload}
                        disabled={!content}
                    />
                </>
            )}
            {canExportDocx && (
                <HeaderAction
                    type={type}
                    icon={isExporting ? Loader2 : FileUp}
                    iconClassName={isExporting ? 'size-4 animate-spin' : undefined}
                    label={isExporting ? 'Exporting...' : 'Export to DOCX'}
                    onClick={handleExportDocx}
                    disabled={isExporting}
                />
            )}
        </>
    );
}
