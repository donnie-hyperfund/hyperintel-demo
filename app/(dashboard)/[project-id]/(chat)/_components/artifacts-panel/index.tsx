'use client';

import { ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { ArtifactHeader } from './artifact-header';

export default function ArtifactsPanel() {
    const { togglePanel, currentArtifact } = useArtifactContext();
    const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>([currentArtifact?.content], {
        threshold: 100,
    });

    if (!currentArtifact) {
        return (
            <div className="flex flex-col h-full bg-neutral-975">
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center space-y-2">
                        <FileText className="size-12 mx-auto opacity-50" />
                        <p className="text-sm">Select a document to preview</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <ArtifactHeader
                title={currentArtifact.title}
                content={currentArtifact.content}
                onCloseAction={() => togglePanel(false)}
            />

            {/* Preview */}
            <div className="relative flex-1 min-h-0">
                <div ref={containerRef} className="h-full overflow-y-auto p-6">
                    <MarkdownRenderer markdown={currentArtifact.content} />
                </div>

                {/* Scroll to bottom button - fixed relative to container */}
                {!isAtBottom && currentArtifact.content.length > 0 && (
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
