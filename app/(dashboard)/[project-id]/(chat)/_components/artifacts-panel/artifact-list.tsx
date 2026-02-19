import { useAuth } from '@clerk/nextjs';
import { FileText, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { useFetchArtifactsInfinite } from '@/lib/api/client/hooks/use-artifacts';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { getPhaseNumber } from '@/lib/phases';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { getArtifactChatId } from '@/modules/chat/providers/artifact-provider/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { ArtifactListItem, ArtifactListItemSkeleton } from './artifact-list-item';
import { PhaseSwitchDialog } from './phase-switch-dialog';

type PhaseDialogData = {
    phaseName: string;
    targetChatId: string;
    artifactKey: string;
    artifactVersion: number;
};

const PAGE_SIZE = 20;

export function ArtifactList() {
    const router = useRouter();
    const { getToken } = useAuth();

    const { projectId, chatId } = useChatContext();

    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchArtifactsInfinite(projectId, {
        limit: PAGE_SIZE,
    });
    const { data: chatsData } = useFetchChats(projectId, { limit: 100 });
    const { addArtifact, updateArtifact } = useArtifactContext();
    const { openPanel } = useActivePanelContext();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogData, setDialogData] = useState<PhaseDialogData | null>(null);

    const artifacts = useMemo(() => {
        if (!data) return [];
        return data.flatMap((page) => page.data);
    }, [data]);

    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    const openArtifactPreview = useCallback(
        async (artifact: ArtifactDto) => {
            if (!projectId) return;
            const localId = artifact.key;
            const version = artifact.version;

            addArtifact({ id: localId, key: artifact.key, title: artifact.title, isLoading: true }, version);
            openPanel({ panel: 'artifact-preview', artifactId: localId, version });

            try {
                const api = createArtifactApi(getToken);
                const data = await api.getByKey(projectId, artifact.key, version);
                updateArtifact(localId, { ...data, id: localId, key: data.key, isLoading: false }, version);
            } catch {
                updateArtifact(localId, { isLoading: false }, version);
            }
        },
        [projectId, getToken, addArtifact, updateArtifact, openPanel],
    );

    const handleArtifactClick = useCallback(
        (artifact: ArtifactDto) => {
            if (!projectId) return;

            const artifactChatId = getArtifactChatId(artifact);

            if (artifactChatId && artifactChatId !== chatId) {
                const phaseNumber = chatsData?.data ? getPhaseNumber(chatsData.data, artifactChatId) : null;

                setDialogData({
                    phaseName: phaseNumber ? `Phase ${phaseNumber}` : 'another phase',
                    targetChatId: artifactChatId,
                    artifactKey: artifact.key,
                    artifactVersion: artifact.version,
                });
                setDialogOpen(true);
                return;
            }

            openArtifactPreview(artifact);
        },
        [projectId, chatId, chatsData?.data, openArtifactPreview],
    );

    const handlePhaseSwitch = useCallback(() => {
        if (!projectId || !dialogData) return;
        setDialogOpen(false);

        const { targetChatId, artifactKey, artifactVersion } = dialogData;
        const search = new URLSearchParams({
            scrollArtifactKey: artifactKey,
            scrollArtifactVersion: String(artifactVersion),
        });
        router.push(`/${projectId}/${targetChatId}?${search}`);
    }, [dialogData, projectId, router]);

    if (error) {
        return (
            <EmptyState
                icon={FileText}
                title="Failed to load deliverables"
                error={error instanceof Error ? error.message : 'An error occurred while loading deliverables.'}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                    <ArtifactListItemSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (artifacts.length === 0) {
        return (
            <EmptyState
                icon={FileText}
                title="No deliverables yet"
                description="Deliverables created during your phases will appear here."
            />
        );
    }

    return (
        <>
            <div className="space-y-2">
                {artifacts.map((artifact) => (
                    <ArtifactListItem
                        key={artifact.id}
                        artifact={artifact}
                        onClick={() => handleArtifactClick(artifact)}
                    />
                ))}
                {(isLoading || hasNextPage) && (
                    <div ref={sentryRef} className="flex items-center justify-center py-3">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                )}
            </div>

            {dialogData && dialogOpen && (
                <PhaseSwitchDialog
                    open={dialogOpen}
                    phaseName={dialogData.phaseName}
                    onConfirm={handlePhaseSwitch}
                    onClose={() => setDialogOpen(false)}
                />
            )}
        </>
    );
}
