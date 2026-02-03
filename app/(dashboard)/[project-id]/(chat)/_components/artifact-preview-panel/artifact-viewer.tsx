'use client';

import { ChevronDown, GitCompare, Loader2, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import type { VersionStatus } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import { computeDiff } from '@/modules/chat/utils/diff-utils';
import { ArtifactApprovalBar } from './artifact-approval-bar';
import { ArtifactHeader } from './artifact-header';
import { DiffViewer } from './diff-viewer';

type ArtifactViewerProps = {
    title: string;
    content: string;
    /** Previous version content for diff comparison */
    previousContent?: string;
    /** Version number to display */
    version?: number;
    /** Version status */
    status?: VersionStatus;
    /** Artifact identifier (key) for API lookups */
    artifactKey?: string;
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

/** Reusable artifact viewer with header and markdown content */
export function ArtifactViewer({
    title,
    content,
    previousContent,
    version,
    status,
    artifactKey,
    updatedAt,
    backHref,
    onCloseAction,
    isStreaming = false,
    isUpdating = false,
}: ArtifactViewerProps) {
    const prevTitleRef = useRef<string | null>(null);
    const [showDiff, setShowDiff] = useState(false);

    const showApprovalBar = status === 'proposed' && !isStreaming && !!artifactKey;
    const canShowDiff = !!previousContent && previousContent !== content && !isStreaming;

    // Compute diff stats for display
    const diffStats = useMemo(() => {
        if (!canShowDiff || !previousContent) return null;
        const diff = computeDiff(previousContent, content);
        return diff.stats;
    }, [canShowDiff, previousContent, content]);

    // Auto-scroll is disabled when not streaming
    const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>([content], {
        threshold: 100,
        disabled: !isStreaming,
    });

    // Scroll to top when a new artifact is loaded (title changes and not streaming)
    useEffect(() => {
        if (!isStreaming && containerRef.current && prevTitleRef.current !== title) {
            containerRef.current.scrollTo({ top: 0, behavior: 'instant' });
        }
        prevTitleRef.current = title;
    }, [isStreaming, title, containerRef]);

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <ArtifactHeader
                title={title}
                content={content}
                version={version}
                status={status}
                updatedAt={updatedAt}
                backHref={backHref}
                onCloseAction={onCloseAction}
            />

            {/* Preview */}
            <div className="relative flex-1 min-h-0">
                <div ref={containerRef} className="h-full overflow-y-auto">
                    {showDiff && previousContent ? (
                        <DiffViewer
                            oldContent={previousContent}
                            newContent={content}
                            className="min-h-full"
                        />
                    ) : content ? (
                        <div className="p-6">
                            <MarkdownRenderer markdown={content} />
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            <p>No content available</p>
                        </div>
                    )}
                </div>

                {/* Updating overlay */}
                {isUpdating && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-xs">
                        <div className="flex items-center gap-2 text-md font-medium text-muted-foreground">
                            <Loader2 className="size-5 animate-spin" />
                            Making changes...
                        </div>
                    </div>
                )}

                {/* Scroll to bottom button */}
                {!isAtBottom && content.length > 0 && !showDiff && (
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
            {canShowDiff && (
                <div className="flex items-center justify-between px-4 py-1.5 border-t border-neutral-800 bg-neutral-900/50">
                    {diffStats && (
                        <div className="flex items-center gap-4 text-xs">
                            <span className="flex items-center gap-1 text-green-400">
                                <Plus className="size-3.5" />
                                {diffStats.added} {diffStats.added === 1 ? 'line' : 'lines'} added
                            </span>
                            <span className="flex items-center gap-1 text-red-400">
                                <Minus className="size-3.5" />
                                {diffStats.removed} {diffStats.removed === 1 ? 'line' : 'lines'} removed
                            </span>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowDiff(!showDiff)}
                        className={cn(
                            'gap-2 text-xs h-7',
                            showDiff
                                ? 'bg-neutral-700/50 text-neutral-200 hover:bg-neutral-700/70'
                                : 'text-neutral-400 hover:text-neutral-300'
                        )}
                    >
                        <GitCompare className="size-3.5" />
                        {showDiff ? 'Hide changes' : 'View changes'}
                    </Button>
                </div>
            )}

            {/* Approval bar */}
            {showApprovalBar && <ArtifactApprovalBar artifactKey={artifactKey} />}
        </div>
    );
}
