'use client';

import { useAuth } from '@clerk/nextjs';
import { Check, ChevronDown, Loader2, X as XIcon } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { artifactKeys, createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import type { VersionStatus } from '@/lib/schema/artifact';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { ArtifactHeader } from './artifact-header';

type ArtifactViewerProps = {
    title: string;
    content: string;
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
    const params = useParams();
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();
    const { updateArtifact } = useArtifactContext();

    const projectId = params?.['project-id'] as string | undefined;

    // Approval state
    const [isApproving, setIsApproving] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [rejectReason, setRejectReason] = useState('');

    const showApprovalBar = status === 'proposed' && !isStreaming;

    const handleApprove = useCallback(async () => {
        if (!projectId || !artifactKey) return;
        setIsApproving(true);
        try {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey);
            if (!artifact.proposed_version) throw new Error('No proposed version found');
            await api.approveVersion(projectId, artifact.id, artifact.proposed_version.id);
            updateArtifact(artifactKey, { proposed_version: { status: 'approved' } });
            globalMutate(artifactKeys.list(projectId));
        } catch (err) {
            console.error('Failed to approve:', err);
        } finally {
            setIsApproving(false);
        }
    }, [projectId, artifactKey, getToken, updateArtifact, globalMutate]);

    const handleReject = useCallback(async () => {
        if (!projectId || !artifactKey || !rejectReason.trim()) return;
        setIsRejecting(true);
        try {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey);
            if (!artifact.proposed_version) throw new Error('No proposed version found');
            await api.rejectVersion(projectId, artifact.id, artifact.proposed_version.id, rejectReason.trim());
            updateArtifact(artifactKey, { proposed_version: { status: 'rejected' } });
            globalMutate(artifactKeys.list(projectId));
            setShowRejectInput(false);
            setRejectReason('');
        } catch (err) {
            console.error('Failed to reject:', err);
        } finally {
            setIsRejecting(false);
        }
    }, [projectId, artifactKey, rejectReason, getToken, updateArtifact, globalMutate]);

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
                <div ref={containerRef} className="h-full overflow-y-auto p-6">
                    {content ? (
                        <MarkdownRenderer markdown={content} />
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
                            Patching document...
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

            {/* Approval bar */}
            {showApprovalBar && (
                <div className="border-t border-border px-4 py-3 space-y-2">
                    <p className="text-xs text-muted-foreground text-center">This document is awaiting your approval</p>
                    {showRejectInput ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleReject()}
                                placeholder="Reason for rejection..."
                                className="flex-1 rounded-md border border-border bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-primary"
                                autoFocus
                            />
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={handleReject}
                                disabled={isRejecting || !rejectReason.trim()}
                            >
                                {isRejecting ? <Loader2 className="size-3 animate-spin" /> : 'Reject'}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    setShowRejectInput(false);
                                    setRejectReason('');
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-2">
                            <Button size="sm" onClick={handleApprove} disabled={isApproving}>
                                {isApproving ? (
                                    <Loader2 className="size-3 animate-spin mr-1" />
                                ) : (
                                    <Check className="size-3 mr-1" />
                                )}
                                Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setShowRejectInput(true)}>
                                <XIcon className="size-3 mr-1" />
                                Reject
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
