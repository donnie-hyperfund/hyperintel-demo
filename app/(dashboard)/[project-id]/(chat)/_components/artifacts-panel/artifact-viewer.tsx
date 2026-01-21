'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { ArtifactHeader } from './artifact-header';

type ArtifactViewerProps = {
    title: string;
    content: string;
    /** Version number to display */
    version?: number;
    /** Subtitle text (e.g., "Updated 2 hours ago") */
    subtitle?: string;
    /** Back link URL - shows back arrow */
    backHref?: string;
    /** Close handler - shows X button */
    onCloseAction?: () => void;
};

/** Reusable artifact viewer with header and markdown content */
export function ArtifactViewer({ title, content, version, subtitle, backHref, onCloseAction }: ArtifactViewerProps) {
    const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>([content], {
        threshold: 100,
    });

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <ArtifactHeader
                title={title}
                content={content}
                version={version}
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
