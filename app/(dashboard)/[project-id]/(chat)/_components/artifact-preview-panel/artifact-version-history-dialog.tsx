'use client';

import { formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { FileText, History, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VersionStatusBadge } from '@/components/ui/version-status-badge';
import { toast } from '@/hooks/use-toast';
import {
    useFetchProjectArtifactByKey,
    useFetchProjectArtifactVersions,
    useRestoreProjectArtifactVersion,
} from '@/lib/api/client/hooks/use-project-artifacts';
import { type ArtifactVersionDto, TERMINAL_VERSION_STATUSES } from '@/lib/schema/artifact';
import { useArtifactContext } from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactVersionContent } from '@/modules/artifacts/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type ArtifactVersionHistoryDialogProps = {
    artifactKey: string;
    artifactId: string;
    currentVersion: number;
};

function getVersionStatusLabel(version: ArtifactVersionDto | undefined): string {
    if (!version?.status) return 'Unknown';
    if (version.status === 'proposed') return 'Pending';
    return version.status.charAt(0).toUpperCase() + version.status.slice(1);
}

export function ArtifactVersionHistoryDialog({
    artifactKey,
    artifactId,
    currentVersion,
}: ArtifactVersionHistoryDialogProps) {
    const [open, setOpen] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

    const { projectId } = useChatContext<'phase'>();
    const { addArtifact } = useArtifactContext();

    const { openPanel } = useActivePanelContext();

    const { data: history, isLoading: isLoadingVersions } = useFetchProjectArtifactVersions(
        open ? projectId : undefined,
        open ? artifactKey : undefined,
    );

    const { trigger: restoreVersion, isMutating: isRestoring } = useRestoreProjectArtifactVersion(
        projectId,
        artifactKey,
    );

    useEffect(() => {
        if (!open || !history) return;
        const defaultVersion =
            history.versions.find((v) => v.version === currentVersion)?.version ?? history.artifact.latestVersion;
        setSelectedVersion(defaultVersion);
    }, [open, history, currentVersion]);

    const versions = history?.versions ?? [];
    const selectedEntry = useMemo(
        () => versions.find((v) => v.version === selectedVersion),
        [versions, selectedVersion],
    );

    const {
        data: previewArtifact,
        isLoading: isLoadingPreview,
        error: previewError,
    } = useFetchProjectArtifactByKey(
        open ? projectId : undefined,
        open && selectedVersion ? artifactKey : undefined,
        selectedVersion ?? undefined,
    );

    const previewContent = previewArtifact ? getLatestArtifactVersionContent(previewArtifact) : '';
    const isLatestNonTerminal =
        !!history &&
        selectedVersion === history.artifact.latestVersion &&
        !!selectedEntry &&
        !TERMINAL_VERSION_STATUSES.includes(selectedEntry.status);
    const isRestoreDisabled = !selectedEntry || isLatestNonTerminal || isRestoring;

    const handleRestore = async () => {
        if (!selectedEntry) return;
        try {
            const updatedArtifact = await restoreVersion({ sourceVersionId: selectedEntry.id });
            const restoredVersion = updatedArtifact.version;

            addArtifact(
                {
                    ...updatedArtifact,
                    id: artifactKey,
                    isLoading: false,
                    isStreaming: false,
                    isUpdating: false,
                },
                restoredVersion,
            );
            openPanel({ panel: 'artifact-preview', artifactId: artifactKey, version: restoredVersion });

            toast({ title: `Restored v${selectedEntry.version} as v${updatedArtifact.version}` });
            setOpen(false);
        } catch (error) {
            console.error('Failed to restore artifact version:', error);
            toast({
                title: error instanceof Error ? error.message : 'Failed to restore version',
                variant: 'destructive',
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                            <History className="size-4" />
                        </Button>
                    </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Version history</TooltipContent>
            </Tooltip>

            <DialogContent className="sm:max-w-5xl h-[min(70vh,680px)] flex flex-col p-0 gap-0 overflow-hidden">
                <DialogHeader className="shrink-0 px-6 pt-6 pb-3">
                    <DialogTitle className="flex items-center gap-2">
                        <History className="size-4" />
                        Version history
                    </DialogTitle>
                    <DialogDescription>
                        Browse all versions for <strong>{history?.artifact.title ?? artifactKey}</strong> and restore
                        any previous one as a new active version.
                    </DialogDescription>
                </DialogHeader>

                <Separator className="shrink-0" />

                <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_300px]">
                    <div className="flex min-h-0 flex-col">
                        <div className="shrink-0 flex h-11 items-center border-b px-4 text-xs text-muted-foreground">
                            {selectedVersion ? (
                                <span>
                                    Previewing v{selectedVersion} ({getVersionStatusLabel(selectedEntry)})
                                </span>
                            ) : (
                                <span>Select a version to preview</span>
                            )}
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="px-5 py-4">
                                {isLoadingPreview && (
                                    <div className="flex min-h-52 items-center justify-center text-muted-foreground">
                                        <Loader2 className="size-4 animate-spin" />
                                    </div>
                                )}

                                {!isLoadingPreview && previewError && (
                                    <p className="text-sm text-destructive">Failed to load version preview.</p>
                                )}

                                {!isLoadingPreview && !previewError && (
                                    <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                                        {previewContent || 'No preview available for this version.'}
                                    </pre>
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    <div className="flex min-h-0 flex-col border-l">
                        <div className="shrink-0 flex h-11 items-center border-b px-4 text-xs font-medium text-muted-foreground">
                            Versions
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="flex flex-col gap-1.5 p-2">
                                {isLoadingVersions && (
                                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                                        <Loader2 className="size-4 animate-spin" />
                                    </div>
                                )}

                                {!isLoadingVersions && versions.length === 0 && (
                                    <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                                        <FileText className="size-5 opacity-60" />
                                        <p className="text-sm">No versions available.</p>
                                    </div>
                                )}

                                {versions.map((version) => {
                                    const isSelected = version.version === selectedVersion;
                                    const changedAt = version.status_changed_at
                                        ? new Date(version.status_changed_at)
                                        : null;
                                    const changedAtLabel = changedAt
                                        ? formatDistanceToNow(changedAt, { addSuffix: true, locale: enUS })
                                        : null;

                                    return (
                                        <button
                                            key={version.id}
                                            type="button"
                                            onClick={() => setSelectedVersion(version.version)}
                                            className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                                                isSelected ? 'bg-accent border-primary/30' : 'hover:bg-accent/50'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-medium">v{version.version}</span>
                                                <VersionStatusBadge
                                                    status={version.status}
                                                    isUploaded={version.is_uploaded}
                                                />
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {changedAtLabel ?? 'Updated recently'}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                <Separator className="shrink-0" />

                <DialogFooter className="shrink-0 px-6 py-4">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isRestoring}>
                        Close
                    </Button>
                    <Button onClick={handleRestore} disabled={isRestoreDisabled}>
                        {isRestoring ? (
                            <>
                                <Loader2 className="size-4 animate-spin mr-1" />
                                Restoring...
                            </>
                        ) : (
                            <>
                                <RotateCcw className="size-4 mr-1" />
                                Restore
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
