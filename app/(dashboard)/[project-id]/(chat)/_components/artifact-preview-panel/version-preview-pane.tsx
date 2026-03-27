'use client';

import { Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

type VersionPreviewPaneProps = {
    selectedVersion: number | null;
    statusLabel: string;
    content: string;
    isLoading: boolean;
    error: Error | undefined;
};

export function VersionPreviewPane({
    selectedVersion,
    statusLabel,
    content,
    isLoading,
    error,
}: VersionPreviewPaneProps) {
    return (
        <div className="flex min-h-0 flex-col">
            <div className="shrink-0 flex h-11 items-center border-b px-4 text-xs text-muted-foreground">
                {selectedVersion ? (
                    <span>
                        Previewing v{selectedVersion} ({statusLabel})
                    </span>
                ) : (
                    <span>Select a version to preview</span>
                )}
            </div>
            <ScrollArea className="flex-1 min-h-0">
                <div className="px-5 py-4">
                    {isLoading && (
                        <div className="flex min-h-52 items-center justify-center text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                        </div>
                    )}

                    {!isLoading && error && <p className="text-sm text-destructive">Failed to load version preview.</p>}

                    {!isLoading && !error && (
                        <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                            {content || 'No preview available for this version.'}
                        </pre>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
