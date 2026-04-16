'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type DirectiveHandler, MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { IS_DEV } from '@/lib/config';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import { getLatestArtifactVersion, getLatestArtifactVersionContent } from '@/modules/artifacts/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import type { Artifact } from '@/modules/chat/types';
import { computeDiffWithDirectives } from '@/modules/chat/utils/diff-utils';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';
import { ArtifactApprovalBar } from './artifact-approval-bar';
import { ArtifactDeleteDocument } from './artifact-delete-document';
import { ArtifactHeader } from './artifact-header';
import { ArtifactVersionHistoryDialog } from './artifact-version-history-dialog';
import { DiffControlBar } from './diff-control-bar';
import { InternalDocumentActions } from './internal-document-actions';
import { InternalDocumentContent } from './internal-document-content';

type ArtifactViewerProps = {
    artifact: Artifact;
    version: number;
    /** Back link URL - shows back arrow */
    backHref?: string;
    /** Close handler - shows X button */
    onCloseAction?: () => void;
};

const diffDirectives: Record<string, DirectiveHandler> = {
    'diff-added': ({ children }) => (
        <div className="diff-block diff-added bg-green-950/30 border-l-2 border-green-500 pl-4 pr-4 -mr-6 -ml-6 py-3 my-2">
            {children}
        </div>
    ),
    'diff-removed': ({ children }) => (
        <div className="diff-block diff-removed bg-red-950/30 border-l-2 border-red-500 pl-4 pr-4 -mr-6 -ml-6 py-3 my-2 opacity-60 line-through decoration-red-400/50">
            {children}
        </div>
    ),
};

/** Reusable artifact viewer with header and markdown content */
export const ArtifactViewer = ({ artifact, version, backHref, onCloseAction }: ArtifactViewerProps) => {
    const prevTitleRef = useRef<string | null>(null);
    const [isDiffVisible, setIsDiffVisible] = useState(false);
    const [isProcessingApproval, setIsProcessingApproval] = useState(false);
    const [isProcessingDelete, setIsProcessingDelete] = useState(false);

    const {
        state: { messages },
        projectId,
    } = useChatContext();
    const { isLinking: isLinkingToProject } = useOptionalProjectOrigin();
    const {
        isProcessing: isProcessingGlobally,
        hasEntry: hasProcessingEntry,
        suppressVersion,
    } = useArtifactProcessing();

    const { title, id: artifactId, key: artifactKey, progress } = artifact;
    const isStreaming = !!artifact.isStreaming;
    const isUpdating = !!artifact.isUpdating;

    const activeVersion = getLatestArtifactVersion(artifact);
    const content = getLatestArtifactVersionContent(artifact);

    const pecpContent = artifact.pecpContent ?? artifact.pecp?.content ?? '';
    const hasPecp = artifact.pecpContent !== undefined || !!artifact.pecp;

    const updatedAt = artifact.proposedVersion?.updatedAt ? new Date(artifact.proposedVersion.updatedAt) : undefined;
    const previousContent =
        artifact.proposedVersion && artifact.currentVersion ? artifact.currentVersion.content : undefined;

    const isLastMessageStreaming = messages[messages.length - 1]?.isStreaming;
    const canApprove =
        activeVersion?.status === 'proposed' &&
        !isStreaming &&
        !!artifactId &&
        !!artifactKey &&
        !isLastMessageStreaming;
    const showApprovalBar = canApprove && (!activeVersion?.isInternal || hasPecp);
    const showInternalActions = canApprove && !!activeVersion?.isInternal && !hasPecp;
    const canDelete =
        !!artifactKey && !!activeVersion?.isUploaded && !isStreaming && activeVersion?.status !== 'deleted';
    const canShowDiff = !!previousContent && previousContent !== content && !isStreaming;
    const isProcessingGlobalApproval = !!(activeVersion?.id && isProcessingGlobally(activeVersion.id));
    const hasEntryForVersion = !!(activeVersion?.id && hasProcessingEntry(activeVersion.id));
    const isBusy = isUpdating || isProcessingApproval || isProcessingDelete || isProcessingGlobalApproval;

    // Suppress this artifact's entry from the status bar while the preview panel is open
    useEffect(() => {
        if (!hasEntryForVersion || !activeVersion?.id) return;
        suppressVersion(activeVersion.id);
        return () => suppressVersion(null);
    }, [hasEntryForVersion, activeVersion?.id, suppressVersion]);

    const diffData = useMemo(() => {
        if (!canShowDiff || !previousContent) return null;
        return computeDiffWithDirectives(previousContent, content);
    }, [canShowDiff, previousContent, content]);

    const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>([content, pecpContent], {
        threshold: 100,
        disabled: !isStreaming,
    });

    const toggleDiffVisibility = () => setIsDiffVisible((prev) => !prev);

    // Scroll to top when a new artifact is loaded (title changes and not streaming)
    useEffect(() => {
        if (!isStreaming && containerRef.current && prevTitleRef.current !== title) {
            containerRef.current.scrollTo({ top: 0, behavior: 'instant' });
        }
        prevTitleRef.current = title;
    }, [isStreaming, title, containerRef]);

    const markdownContent = isDiffVisible && diffData ? diffData.markdownWithDiff : content;

    const headerActions = (
        <>
            {IS_DEV && artifactKey && artifactId && (
                <ArtifactVersionHistoryDialog
                    artifactKey={artifactKey}
                    artifactId={artifactId}
                    currentVersion={version}
                />
            )}
            {canDelete && !!projectId && (
                <ArtifactDeleteDocument
                    artifactKey={artifactKey!}
                    title={title}
                    onProcessingChange={setIsProcessingDelete}
                    onDeleted={onCloseAction}
                />
            )}
        </>
    );

    const renderContent = () => {
        if (activeVersion?.isInternal && !hasPecp) {
            return (
                <InternalDocumentContent title={title} progress={progress} isStreaming={isStreaming}>
                    {showInternalActions && (
                        <InternalDocumentActions
                            artifactId={artifactId}
                            version={version}
                            disabled={isUpdating}
                            onProcessingChange={setIsProcessingApproval}
                        />
                    )}
                </InternalDocumentContent>
            );
        }

        const displayContent = pecpContent || markdownContent;
        if (displayContent) {
            return (
                <div className="p-6">
                    <MarkdownRenderer
                        markdown={displayContent}
                        directives={pecpContent ? undefined : diffDirectives}
                        scrollContainerRef={containerRef}
                    />
                </div>
            );
        }

        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                <p>No content available</p>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <ArtifactHeader
                title={title}
                content={content}
                version={version}
                status={activeVersion?.status}
                documentType={activeVersion?.documentType}
                isUploaded={activeVersion?.isUploaded}
                isInternal={activeVersion?.isInternal}
                artifactVersionId={activeVersion?.id}
                updatedAt={updatedAt}
                backHref={backHref}
                onCloseAction={onCloseAction}
                actions={headerActions}
                isStreaming={isStreaming}
            />

            {/* Preview */}
            <div className="relative flex-1 min-h-0">
                <div ref={containerRef} className="h-full overflow-y-auto">
                    {renderContent()}
                </div>

                {/* Busy overlay */}
                {isBusy && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-xs">
                        <div className="flex items-center gap-2 text-md font-medium text-muted-foreground">
                            <Loader2 className="size-5 animate-spin" />
                            {isProcessingDelete
                                ? 'Deleting...'
                                : isLinkingToProject
                                  ? 'Adding to Project Intel...'
                                  : isProcessingApproval || activeVersion?.status === 'proposed'
                                    ? 'Processing...'
                                    : 'Making changes...'}
                        </div>
                    </div>
                )}

                {/* Scroll to bottom button */}
                {!isAtBottom && content.length > 0 && (
                    <Button
                        onClick={() => scrollToBottom({ behavior: 'smooth' })}
                        variant="secondary"
                        className="size-10 absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full shadow-xl z-10"
                        aria-label="Scroll to bottom"
                    >
                        <ChevronDown className="size-4" />
                    </Button>
                )}
            </div>

            {/* Diff controls bar */}
            {canShowDiff && diffData && (
                <DiffControlBar diffData={diffData} isDiffVisible={isDiffVisible} onToggle={toggleDiffVisibility} />
            )}

            {/* Approval bar */}
            {showApprovalBar && (
                <ArtifactApprovalBar
                    artifactId={artifactId}
                    version={version}
                    disabled={isUpdating}
                    onProcessingChange={setIsProcessingApproval}
                />
            )}
        </div>
    );
};
