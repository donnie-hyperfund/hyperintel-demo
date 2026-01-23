'use client';

import { useAuth } from '@clerk/nextjs';
import { formatDistanceToNow } from 'date-fns';
import { FileText, Layers } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { useFetchArtifacts } from '@/lib/api/client/hooks/use-artifacts';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { getPhaseNumber } from '@/lib/phases';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';

export function DashboardHeader() {
    const params = useParams();
    const { getToken } = useAuth();
    const projectId = params?.['project-id'] as string | undefined;
    const chatId = params?.chatId as string | undefined;
    const [sheetOpen, setSheetOpen] = useState(false);

    const { addArtifact, setCurrentArtifact, setLoading } = useArtifactContext();
    const { data: project } = useFetchProject(projectId);
    const { data: chatsData } = useFetchChats(projectId, { limit: 100 });
    const { data: artifactsData, isLoading: artifactsLoading } = useFetchArtifacts(projectId);

    const phaseNumber = chatId && chatsData?.data ? getPhaseNumber(chatsData.data, chatId) : null;
    const breadcrumb = [project?.name, phaseNumber ? `Phase ${phaseNumber}` : null].filter(Boolean).join(' / ');
    const artifacts = artifactsData?.data ?? [];

    const handleArtifactClick = async (artifactId: string, title: string) => {
        if (!projectId) return;
        setSheetOpen(false);
        setLoading(true, title);

        try {
            const api = createArtifactApi(getToken);
            const artifact = await api.get(projectId, artifactId);
            const localId = `artifact-${artifact.id}-v${artifact.version}`;

            addArtifact({
                id: localId,
                identifier: artifact.key,
                title: artifact.title,
                type: 'text/markdown',
                content: artifact.current_version?.content ?? '',
                messageId: '',
            });
            setCurrentArtifact(localId);
        } catch {
            setLoading(false);
        }
    };

    return (
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
            <div className="flex items-center gap-2">
                {breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
            </div>
            <div className="ml-auto">
                <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <Layers className="size-4" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="right">
                        <SheetHeader>
                            <SheetTitle>Artifacts</SheetTitle>
                        </SheetHeader>
                        <div className="flex-1 overflow-y-auto px-4 pb-4">
                            {artifactsLoading ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="space-y-2 rounded-lg border p-3">
                                            <Skeleton className="h-4 w-3/4" />
                                            <Skeleton className="h-3 w-1/2" />
                                        </div>
                                    ))}
                                </div>
                            ) : artifacts.length === 0 ? (
                                <EmptyState
                                    icon={FileText}
                                    title="No artifacts yet"
                                    description="Artifacts created during your phases will appear here."
                                />
                            ) : (
                                <div className="space-y-2">
                                    {artifacts.map((artifact) => {
                                        const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : null;
                                        const timeAgo = updatedAt
                                            ? formatDistanceToNow(updatedAt, { addSuffix: true })
                                            : null;

                                        return (
                                            <button
                                                key={artifact.id}
                                                type="button"
                                                onClick={() => handleArtifactClick(artifact.id, artifact.title)}
                                                className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <FileText className="size-4 shrink-0 text-neutral-500" />
                                                    <span className="line-clamp-1 text-sm font-medium">
                                                        {artifact.title}
                                                    </span>
                                                </div>
                                                <div className="mt-1 flex items-center gap-2 pl-6 text-xs text-neutral-500">
                                                    <span>v{artifact.version}</span>
                                                    {timeAgo && (
                                                        <>
                                                            <span>·</span>
                                                            <span>{timeAgo}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </SheetContent>
                </Sheet>
            </div>
        </header>
    );
}
