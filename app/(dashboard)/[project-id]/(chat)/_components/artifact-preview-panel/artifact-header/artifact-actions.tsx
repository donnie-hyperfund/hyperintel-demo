'use client';

import { useAuth } from '@clerk/nextjs';
import { Check, Copy, Download, FileUp, Loader2, LocateFixed } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useClipboardAction } from '@/hooks/use-clipboard-action';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { exportArtifact } from '@/lib/api/requests/worker/chat';
import { getPhaseNumber } from '@/lib/phases';
import { SEARCH_PARAMS } from '@/lib/search-params';
import { downloadBlob } from '@/lib/utils';
import { getArtifactChatId } from '@/modules/artifacts/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useScrollTargetContext } from '@/modules/chat/providers/scroll-target-provider';
import type { Artifact } from '@/modules/chat/types';
import { PhaseSwitchDialog } from '../../phase-switch-dialog';
import type { ActionType } from './header-action';
import { HeaderAction } from './header-action';

type ArtifactActionsProps = {
    type: ActionType;
    title: string;
    content: string;
    isInternal?: boolean;
    artifactVersionId?: string;
    isStreaming?: boolean;
    artifact?: Artifact;
    version?: number;
};

export function ArtifactActions({
    type,
    title,
    content,
    isInternal,
    artifactVersionId,
    isStreaming,
    artifact,
    version,
}: ArtifactActionsProps) {
    const { getToken } = useAuth();
    const { isCopied, copy } = useClipboardAction();
    const [isDownloaded, setIsDownloaded] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [phaseSwitchData, setPhaseSwitchData] = useState<{
        phaseName: string;
        targetChatId: string;
    } | null>(null);

    const router = useRouter();
    const { scrollTo } = useScrollTargetContext();
    const { projectId, chatId } = useChatContext();
    // TODO: Refactor this and use a better way of getting the phase number
    const { data: chatsData } = useFetchChats(projectId ?? '', { limit: 100 });

    const artifactKey = artifact?.key;

    const canExportDocx = !isInternal && !!artifactVersionId && !!content;
    const showContentActions = !!content && !isStreaming;

    /**
     * Use the canonical artifact key (e.g. `HIAI_LI_Strategy_Mason_Crystal_v1_0.md`)
     * as the download filename so files keep their naming-convention identity after
     * they leave the system. Falls back to the display title for artifacts without
     * a canonical key (e.g. uploaded files).
     */
    const downloadBaseName = artifactKey || title;

    const handleDownload = () => {
        const blob = new Blob([content], { type: 'text/markdown' });
        downloadBlob(blob, downloadBaseName.endsWith('.md') ? downloadBaseName : `${downloadBaseName}.md`);
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
            downloadBlob(blob, `${downloadBaseName.replace(/\.md$/, '')}.docx`);
        } catch (err) {
            console.error('[exportDocx] Failed:', err);
        } finally {
            setIsExporting(false);
        }
    };

    const handleFindInChat = useCallback(() => {
        if (!artifactKey || !artifact || version == null) return;

        const artifactChatId = getArtifactChatId(artifact);

        if (artifactChatId && artifactChatId !== chatId) {
            const phaseNumber = chatsData?.data ? getPhaseNumber(chatsData.data, artifactChatId) : null;
            setPhaseSwitchData({
                phaseName: phaseNumber ? `Phase ${phaseNumber}` : 'another phase',
                targetChatId: artifactChatId,
            });
            return;
        }

        scrollTo({ key: artifactKey, version });
    }, [artifact, artifactKey, chatId, chatsData?.data, scrollTo, version]);

    const handlePhaseSwitch = useCallback(() => {
        if (!phaseSwitchData || !projectId || !artifactKey || version == null) return;
        setPhaseSwitchData(null);
        const search = new URLSearchParams({
            [SEARCH_PARAMS.SCROLL_ARTIFACT_KEY]: artifactKey,
            [SEARCH_PARAMS.SCROLL_ARTIFACT_VERSION]: String(version),
        });
        router.push(`/${projectId}/${phaseSwitchData.targetChatId}?${search}`);
    }, [phaseSwitchData, projectId, artifactKey, version, router]);

    return (
        <>
            {artifactKey && version != null && (
                <HeaderAction type={type} icon={LocateFixed} label="Find in chat" onClick={handleFindInChat} />
            )}
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
            {phaseSwitchData && (
                <PhaseSwitchDialog
                    open
                    phaseName={phaseSwitchData.phaseName}
                    onConfirm={handlePhaseSwitch}
                    onClose={() => setPhaseSwitchData(null)}
                />
            )}
        </>
    );
}
