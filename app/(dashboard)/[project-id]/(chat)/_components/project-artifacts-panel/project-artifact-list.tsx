import { useAuth } from '@clerk/nextjs';
import { FileText, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import type { ProjectArtifactFilterParams } from '@/lib/api/client/fetchers/project-artifacts';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { useFetchProjectArtifactsInfinite } from '@/lib/api/client/hooks/use-project-artifacts';
import { getPhaseNumber } from '@/lib/phases';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { getArtifactChatId } from '@/modules/chat/providers/artifact-provider/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { PhaseSwitchDialog } from '../phase-switch-dialog';
import type { ProjectArtifactFilters } from './project-artifact-filter-dropdown';
import { getActiveFilterCount } from './project-artifact-filter-dropdown';
import { ArtifactListItemSkeleton, ProjectArtifactListItem } from './project-artifact-list-item';

function filtersToParams(filters: ProjectArtifactFilters): ProjectArtifactFilterParams {
    const params: ProjectArtifactFilterParams = {};
    if (filters.visibility.length) params.visibility = filters.visibility;
    if (filters.status.length) params.status = filters.status;
    if (filters.chatIds.length) params.chatId = filters.chatIds;
    return params;
}

type PhaseDialogData = {
    phaseName: string;
    targetChatId: string;
    artifactKey: string;
    artifactVersion: number;
};

const PAGE_SIZE = 20;

type ProjectArtifactListProps = {
    filters: ProjectArtifactFilters;
};

export function ProjectArtifactList({ filters }: ProjectArtifactListProps) {
    const router = useRouter();
    const { getToken } = useAuth();

    const { projectId, chatId } = useChatContext();

    const filterParams = useMemo(() => filtersToParams(filters), [filters]);

    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchProjectArtifactsInfinite(
        projectId ?? undefined,
        {
            limit: PAGE_SIZE,
            ...filterParams,
        },
    );
    const { data: chatsData } = useFetchChats(projectId ?? undefined, { limit: 100 });

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
                const api = createProjectArtifactApi(getToken);
                const data = await api.getByKey(projectId, artifact.key, version);
                updateArtifact(localId, { ...data, id: localId, key: data.key, isLoading: false }, version);
            } catch {
                updateArtifact(localId, { isLoading: false }, version);
            }
        },
        [projectId, getToken, addArtifact, updateArtifact, openPanel],
    );

    const navigateToArtifact = useCallback(
        (targetChatId: string, artifactKey: string, artifactVersion: number) => {
            if (!projectId) return;
            const search = new URLSearchParams({
                scrollArtifactKey: artifactKey,
                scrollArtifactVersion: String(artifactVersion),
            });
            router.push(`/${projectId}/${targetChatId}?${search}`);
        },
        [projectId, router],
    );

    const scrollToArtifact = useCallback(
        (artifact: ArtifactDto) => {
            const artifactChatId = getArtifactChatId(artifact);
            if (!artifactChatId) return;
            navigateToArtifact(artifactChatId, artifact.key, artifact.version);
        },
        [navigateToArtifact],
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
            scrollToArtifact(artifact);
        },
        [projectId, chatId, chatsData?.data, openArtifactPreview],
    );

    const handlePhaseSwitch = useCallback(() => {
        if (!dialogData) return;
        setDialogOpen(false);
        const { targetChatId, artifactKey, artifactVersion } = dialogData;
        navigateToArtifact(targetChatId, artifactKey, artifactVersion);
    }, [dialogData, navigateToArtifact]);

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

    const hasActiveFilters = getActiveFilterCount(filters) > 0;

    if (artifacts.length === 0) {
        return (
            <EmptyState
                icon={FileText}
                title={hasActiveFilters ? 'No deliverables match these filters' : 'No deliverables yet'}
                description={hasActiveFilters ? undefined : 'Deliverables created during your phases will appear here.'}
            />
        );
    }

    return (
        <>
            <div className="space-y-2">
                {artifacts.map((artifact) => (
                    <ProjectArtifactListItem
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
