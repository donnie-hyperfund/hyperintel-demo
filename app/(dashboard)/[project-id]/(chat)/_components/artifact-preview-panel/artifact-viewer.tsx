'use client';

import { AnimatePresence } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { type DirectiveHandler, MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import {
    getLatestArtifactVersion,
    getLatestArtifactVersionContent,
    getLatestArtifactVersionTitle,
} from '@/modules/artifacts/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import type { Artifact } from '@/modules/chat/types';
import { computeDiffWithDirectives } from '@/modules/chat/utils/diff-utils';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';
import { ScrollToBottomButton } from '../scroll-to-bottom-button';
import { ArtifactApprovalBar } from './artifact-approval-bar';
import { ArtifactDeleteDocument } from './artifact-delete-document';
import { ArtifactHeader } from './artifact-header';
import { ArtifactPreviewOverlay } from './artifact-preview-overlay';
import { ArtifactVersionHistoryDialog } from './artifact-version-history-dialog';
import { DiffControlBar } from './diff-control-bar';
import { InternalDocumentActions } from './internal-document-actions';
import { InternalDocumentContent } from './internal-document-content';
import { useArtifactOverlayState } from './use-artifact-overlay-state';
import { useArtifactScroll } from './use-artifact-scroll';

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
    const [isDiffVisible, setIsDiffVisible] = useState(false);
    const [processingAction, setProcessingAction] = useState<'approve' | 'reject' | null>(null);
    const [isProcessingDelete, setIsProcessingDelete] = useState(false);

    const {
        state: { messages },
        projectId,
    } = useChatContext();
    const { isLinking: isLinkingToProject } = useOptionalProjectOrigin();
    const {
        hasEntry: hasProcessingEntry,
        getEntry: getProcessingEntry,
        reconcileVersionStatus,
        suppressVersion,
    } = useArtifactProcessing();

    const { id: artifactId, key: artifactKey, progress } = artifact;
    const title = getLatestArtifactVersionTitle(artifact);
    const isStreaming = !!artifact.isStreaming;
    const isUpdating = !!artifact.isUpdating;
    const isSummaryStreaming = !!artifact.isSummaryStreaming;

    const activeVersion = getLatestArtifactVersion(artifact);
    const content = getLatestArtifactVersionContent(artifact);

    const summaryContent =
        artifact.summaryStreaming ??
        artifact.proposedVersion?.summaryInternal ??
        artifact.currentVersion?.summaryInternal ??
        '';
    const hasSummary = !!summaryContent || !!artifact.isSummaryStreaming;

    const updatedAt = artifact.proposedVersion?.updatedAt ? new Date(artifact.proposedVersion.updatedAt) : undefined;
    const previousContent =
        artifact.proposedVersion && artifact.currentVersion ? artifact.currentVersion.content : undefined;

    const isLastMessageStreaming = messages[messages.length - 1]?.isStreaming;
    const isApprovalLocked = isStreaming || !!isLastMessageStreaming;
    const isProposedVersion = activeVersion?.status === 'proposed' && !!artifactId && !!artifactKey;
    const canApprove = isProposedVersion && !isApprovalLocked;
    const showApprovalBar = isProposedVersion && (!activeVersion?.isInternal || hasSummary);
    const showInternalActions = canApprove && !!activeVersion?.isInternal && !hasSummary;
    const canDelete =
        !!artifactKey && !!activeVersion?.isUploaded && !isStreaming && activeVersion?.status !== 'deleted';
    const isProposed = activeVersion?.status === 'proposed';
    const canShowDiff =
        isProposed && !activeVersion?.isInternal && !!previousContent && previousContent !== content && !isStreaming;
    const hasEntryForVersion = !!(activeVersion?.id && hasProcessingEntry(activeVersion.id));
    const processingEntry = activeVersion?.id ? getProcessingEntry(activeVersion.id) : undefined;
    const overlayState = useArtifactOverlayState({
        isProcessingDelete,
        isLinkingToProject,
        processingAction,
        processingEntry,
        isUpdating,
        isSummaryStreaming,
    });

    // Suppress this artifact's entry from the status bar while the preview panel is open
    useEffect(() => {
        if (!hasEntryForVersion || !activeVersion?.id) return;
        suppressVersion(activeVersion.id);
        return () => suppressVersion(null);
    }, [hasEntryForVersion, activeVersion?.id, suppressVersion]);

    useEffect(() => {
        if (!activeVersion?.id) return;
        reconcileVersionStatus({ versionId: activeVersion.id, status: activeVersion.status ?? null });
    }, [activeVersion?.id, activeVersion?.status, reconcileVersionStatus]);

    useEffect(() => {
        if (!isProposed) setIsDiffVisible(false);
    }, [isProposed]);

    const diffData = useMemo(() => {
        if (!canShowDiff || !previousContent) return null;
        return computeDiffWithDirectives(previousContent, content);
    }, [canShowDiff, previousContent, content]);

    const { containerRef, isAtBottom, scrollToBottom } = useArtifactScroll({
        artifactKey,
        versionNumber: activeVersion?.version,
        content,
        summaryContent,
        isStreaming,
    });

    const toggleDiffVisibility = () => setIsDiffVisible((prev) => !prev);

    const markdownContent = isDiffVisible && diffData ? diffData.markdownWithDiff : content;

    const headerActions = (
        <>
            {artifactKey && artifactId && (
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
        if (activeVersion?.isInternal && !hasSummary) {
            return (
                <InternalDocumentContent title={title} progress={progress} isStreaming={isStreaming}>
                    {showInternalActions && (
                        <InternalDocumentActions
                            artifactId={artifactId}
                            version={version}
                            disabled={isUpdating}
                            onProcessingChange={setProcessingAction}
                        />
                    )}
                </InternalDocumentContent>
            );
        }

        const displayContent = summaryContent || markdownContent;
        if (displayContent) {
            return (
                <div className="p-6">
                    <MarkdownRenderer
                        markdown={displayContent}
                        directives={summaryContent ? undefined : diffDirectives}
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
                artifact={artifact}
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
                {overlayState && (
                    <ArtifactPreviewOverlay
                        state={overlayState}
                        documentType={activeVersion?.documentType}
                        isInternal={activeVersion?.isInternal}
                        contentLength={content.length}
                    />
                )}
                <AnimatePresence>
                    {!isAtBottom && (summaryContent || content).length > 0 && (
                        <ScrollToBottomButton
                            key="artifact-scroll-to-bottom"
                            onClick={() => scrollToBottom()}
                            className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2"
                        />
                    )}
                </AnimatePresence>
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
                    disabled={isUpdating || !!isLastMessageStreaming}
                    isStreaming={isStreaming}
                    onProcessingChange={setProcessingAction}
                />
            )}
        </div>
    );
};
