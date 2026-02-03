'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { ArtifactHeader, type VersionStatus } from './artifact-header';

type ArtifactViewerProps = {
    title: string;
    content: string;
    /** Version number to display */
    version?: number;
    /** Version status */
    status?: VersionStatus;
    /** Subtitle text (e.g., "Updated 2 hours ago") */
    subtitle?: string;
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
    subtitle,
    backHref,
    onCloseAction,
    isStreaming = false,
    isUpdating = false,
}: ArtifactViewerProps) {
    const prevTitleRef = useRef<string | null>(null);

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
                subtitle={subtitle}
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
        </div>
    );
}
