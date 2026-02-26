'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type DirectiveHandler, MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { isIntakeDocument } from '@/lib/artifacts/utils';
import type { DocumentType, VersionStatus } from '@/lib/schema/artifact';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { computeDiffWithDirectives } from '@/modules/chat/utils/diff-utils';
import { ArtifactApprovalBar } from './artifact-approval-bar';
import { ArtifactDeleteDocument } from './artifact-delete-document';
import { ArtifactHeader } from './artifact-header';
import { DiffControlBar } from './diff-control-bar';

type ArtifactViewerProps = {
    title: string;
    content: string;
    /** Previous version content for diff comparison */
    previousContent?: string;
    /** Version number to display */
    version: number;
    /** Version status */
    status?: VersionStatus;
    /** Whether the artifact is uploaded */
    isUploaded?: boolean;
    /** Whether the artifact is internal (not exportable) */
    isInternal?: boolean;
    /** Document type of the artifact */
    documentType?: DocumentType;
    /** The active version's UUID */
    artifactVersionId?: string;
    /** Artifact identifier (key) for API lookups */
    artifactKey?: string;
    /** Artifact ID for store lookups */
    artifactId?: string;
    /** Updated at date */
    updatedAt?: Date;
    /** Back link URL - shows back arrow */
    backHref?: string;
    /** Close handler - shows X button */
    onCloseAction?: () => void;
    /** Whether content is being streamed - enables auto-scroll to bottom */
    isStreaming?: boolean;
    /** Whether an existing document is being patched */
    isUpdating?: boolean;
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
export const ArtifactViewer = ({
    title,
    content,
    previousContent,
    version,
    status,
    isUploaded,
    isInternal,
    documentType,
    artifactVersionId,
    artifactKey,
    artifactId,
    updatedAt,
    backHref,
    onCloseAction,
    isStreaming = false,
    isUpdating = false,
}: ArtifactViewerProps) => {
    const prevTitleRef = useRef<string | null>(null);
    const [isDiffVisible, setIsDiffVisible] = useState(false);
    const [isProcessingApproval, setIsProcessingApproval] = useState(false);
    const [isProcessingDelete, setIsProcessingDelete] = useState(false);

    const {
        state: { messages },
        projectId,
    } = useChatContext();

    const isLastMessageStreaming = messages[messages.length - 1]?.isStreaming;
    const showApprovalBar =
        !isIntakeDocument(documentType) &&
        status === 'proposed' &&
        !isStreaming &&
        !!artifactKey &&
        !isLastMessageStreaming;
    const canDelete = !!artifactKey && !!isUploaded && !isStreaming && status !== 'deleted';
    const canShowDiff = !!previousContent && previousContent !== content && !isStreaming;
    const isBusy = isUpdating || isProcessingApproval || isProcessingDelete;

    const diffData = useMemo(() => {
        if (!canShowDiff || !previousContent) return null;
        return computeDiffWithDirectives(previousContent, content);
    }, [canShowDiff, previousContent, content]);

    // Auto-scroll is disabled when not streaming
    const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>([content], {
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

    // TODO: Remove the !!projectId when backend is updated and we can use a unified artifact API
    const deleteAction = canDelete && !!projectId && (
        <ArtifactDeleteDocument
            artifactKey={artifactKey!}
            title={title}
            onProcessingChange={setIsProcessingDelete}
            onDeleted={onCloseAction}
        />
    );

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <ArtifactHeader
                title={title}
                content={content}
                version={version}
                status={status}
                documentType={documentType}
                isUploaded={isUploaded}
                isInternal={isInternal}
                artifactVersionId={artifactVersionId}
                updatedAt={updatedAt}
                backHref={backHref}
                onCloseAction={onCloseAction}
                actions={deleteAction}
                isStreaming={!!isStreaming}
            />

            {/* Preview */}
            <div className="relative flex-1 min-h-0">
                <div ref={containerRef} className="h-full overflow-y-auto">
                    {markdownContent ? (
                        <div className="p-6">
                            <MarkdownRenderer
                                markdown={markdownContent}
                                directives={diffDirectives}
                                scrollContainerRef={containerRef}
                            />
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            <p>No content available</p>
                        </div>
                    )}
                </div>

                {/* Busy overlay */}
                {isBusy && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-xs">
                        <div className="flex items-center gap-2 text-md font-medium text-muted-foreground">
                            <Loader2 className="size-5 animate-spin" />
                            {isProcessingDelete
                                ? 'Deleting...'
                                : isProcessingApproval
                                  ? 'Processing...'
                                  : 'Making changes...'}
                        </div>
                    </div>
                )}

                {/* Scroll to bottom button */}
                {!isAtBottom && content.length > 0 && (
                    <Button
                        onClick={() => scrollToBottom({ behavior: 'smooth' })}
                        size="icon-lg"
                        variant="secondary"
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full shadow-xl z-10"
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
                    artifactId={artifactId!}
                    artifactKey={artifactKey}
                    artifactVersion={version}
                    onProcessingChange={setIsProcessingApproval}
                />
            )}
        </div>
    );
};
