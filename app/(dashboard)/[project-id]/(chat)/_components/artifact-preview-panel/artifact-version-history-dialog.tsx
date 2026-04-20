'use client';

import { History, Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
    useFetchProjectArtifactByKey,
    useFetchProjectArtifactVersions,
} from '@/lib/api/client/hooks/use-project-artifacts';
import { type ArtifactVersionDto, TERMINAL_VERSION_STATUSES } from '@/lib/schema/artifact';
import { useArtifactRestore } from '@/modules/artifacts/hooks/use-artifact-restore';
import { getLatestArtifactVersionContent } from '@/modules/artifacts/utils';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { VersionListPane } from './version-list-pane';
import { VersionPreviewPane } from './version-preview-pane';

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

    const chatContext = useChatContext();
    const projectId = chatContext.chatType === 'phase' ? chatContext.projectId : undefined;

    const {
        data: history,
        isLoading: isLoadingVersions,
        mutate: mutateHistory,
    } = useFetchProjectArtifactVersions(open ? projectId : undefined, open ? artifactKey : undefined);

    const { restore, isRestoring, isGenerating, redirectDialog } = useArtifactRestore({ artifactKey });

    useEffect(() => {
        if (!open || !history) return;
        const defaultVersion =
            history.versions.find((v) => v.version === currentVersion)?.version ?? history.artifact.latestVersion;
        setSelectedVersion(defaultVersion);
    }, [open, history, currentVersion]);

    // Revalidate version list on status changes (e.g. approve/reject happening under this dialog).
    useUserEvents(
        useCallback(
            (eventType: string) => {
                if (eventType === 'artifact_version_updated' || eventType === 'artifact_version_created') {
                    mutateHistory();
                }
            },
            [mutateHistory],
        ),
    );

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

    const previewContent =
        previewArtifact?.pecp?.content ?? (previewArtifact ? getLatestArtifactVersionContent(previewArtifact) : '');
    const isLatestNonTerminal =
        !!history &&
        selectedVersion === history.artifact.latestVersion &&
        !!selectedEntry &&
        !TERMINAL_VERSION_STATUSES.includes(selectedEntry.status);
    const isCurrentActive =
        !!history && selectedVersion === history.artifact.currentVersion && selectedEntry?.status === 'approved';
    const isRestoreDisabled = !selectedEntry || isLatestNonTerminal || isCurrentActive || isRestoring || isGenerating;

    const handleRestore = async () => {
        if (!selectedEntry) return;
        try {
            await restore({ sourceVersionId: selectedEntry.id, sourceVersionNumber: selectedEntry.version });
            setOpen(false);
        } catch (error) {
            console.error('Failed to restore artifact version:', error);
        }
    };

    return (
        <>
            <Dialog open={redirectDialog.open}>
                <DialogContent
                    showCloseButton={false}
                    onPointerDownOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle>Version restored successfully</DialogTitle>
                        <DialogDescription>
                            The restored version was linked to the latest phase. You&apos;ll be redirected there so the
                            agent can review and respond.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={redirectDialog.onConfirm}>Go to latest phase</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
                    <DialogHeader className="shrink-0 pl-6 pr-12 pt-6 pb-3">
                        <DialogTitle className="flex items-center gap-2">
                            <History className="size-4" />
                            Version history
                        </DialogTitle>
                        <DialogDescription className="max-w-prose">
                            Browse and restore previous versions of{' '}
                            <strong>{history?.artifact.title ?? artifactKey}</strong>. Restoring creates a new approved
                            version and notifies the agent
                            {projectId ? ' in the latest phase' : ''}.
                        </DialogDescription>
                    </DialogHeader>

                    <Separator className="shrink-0" />

                    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_300px]">
                        <VersionPreviewPane
                            selectedVersion={selectedVersion}
                            statusLabel={getVersionStatusLabel(selectedEntry)}
                            content={previewContent}
                            isLoading={isLoadingPreview}
                            error={previewError}
                        />
                        <VersionListPane
                            versions={versions}
                            selectedVersion={selectedVersion}
                            onSelect={setSelectedVersion}
                            isLoading={isLoadingVersions}
                        />
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
        </>
    );
}
