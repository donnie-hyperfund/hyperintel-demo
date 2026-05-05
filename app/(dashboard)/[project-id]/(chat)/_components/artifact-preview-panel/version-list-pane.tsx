'use client';

import { formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { FileText, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { VersionStatusBadge } from '@/components/ui/version-status-badge';
import type { ArtifactVersionDto } from '@/lib/schema/artifact';

type VersionListPaneProps = {
    versions: ArtifactVersionDto[];
    selectedVersion: number | null;
    onSelect: (version: number) => void;
    isLoading: boolean;
};

export function VersionListPane({ versions, selectedVersion, onSelect, isLoading }: VersionListPaneProps) {
    return (
        <div className="flex min-h-0 flex-col border-t md:border-t-0 md:border-l">
            <div className="shrink-0 flex h-11 items-center border-b px-4 text-xs font-medium text-muted-foreground">
                Versions
            </div>
            <ScrollArea className="flex-1 min-h-0">
                <div className="flex flex-col gap-1.5 p-2">
                    {isLoading && (
                        <div className="flex items-center justify-center py-6 text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                        </div>
                    )}

                    {!isLoading && versions.length === 0 && (
                        <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                            <FileText className="size-5 opacity-60" />
                            <p className="text-sm">No versions available.</p>
                        </div>
                    )}

                    {versions.map((version) => {
                        const isSelected = version.version === selectedVersion;
                        const changedAt = version.status_changed_at ? new Date(version.status_changed_at) : null;
                        const changedAtLabel = changedAt
                            ? formatDistanceToNow(changedAt, { addSuffix: true, locale: enUS })
                            : null;

                        return (
                            <button
                                key={version.id}
                                type="button"
                                onClick={() => onSelect(version.version)}
                                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                                    isSelected ? 'bg-accent border-primary/30' : 'hover:bg-accent/50'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium">v{version.version}</span>
                                    <VersionStatusBadge status={version.status} isUploaded={version.is_uploaded} />
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    {changedAtLabel ?? 'Updated recently'}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
}
