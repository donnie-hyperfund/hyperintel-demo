'use client';

import type { LucideIcon } from 'lucide-react';
import { Building, Building2, Dna, Loader2, Users } from 'lucide-react';
import { useMemo, useRef } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchResources } from '@/lib/api/client/hooks/use-resources';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { ArtifactListItem, ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';

type ResourceSelectListProps = {
    selectedIds: string[];
    onToggle: (id: string) => void;
    onClearAll: () => void;
};

export function ResourceSelectList({ selectedIds, onToggle, onClearAll }: ResourceSelectListProps) {
    const { companies, stakeholders, legacyDna, isLoading, hasNextPage, size, setSize } = useFetchResources({
        limit: 20,
        approvedOnly: true,
        documentType: ['Legacy DNA', 'Company Profile', 'Human Persona'],
    });

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    const totalCount = useMemo(
        () => companies.length + stakeholders.length + legacyDna.length,
        [companies, stakeholders, legacyDna],
    );

    if (isLoading && size === 1) {
        return (
            <div className="space-y-2 px-4 py-6">
                {Array.from({ length: 4 }, (_, i) => (
                    <ArtifactListItemSkeleton key={i} size="sm" />
                ))}
            </div>
        );
    }

    if (totalCount === 0) {
        return (
            <div className="px-8 py-6">
                <EmptyState
                    icon={Building2}
                    title="No resources yet"
                    description="Companies, stakeholders, and legacy DNA will appear here once created."
                />
            </div>
        );
    }

    const selectedCount = selectedIds.length;

    return (
        <>
            <div ref={scrollContainerRef} className="md:max-h-128 md:overflow-y-auto px-4 py-6 space-y-4">
                <Section
                    title="Legacy DNA"
                    icon={Dna}
                    artifacts={legacyDna}
                    selectedIds={selectedIds}
                    onToggle={onToggle}
                />
                <Section
                    title="Companies"
                    icon={Building}
                    artifacts={companies}
                    selectedIds={selectedIds}
                    onToggle={onToggle}
                />
                <Section
                    title="Stakeholders"
                    icon={Users}
                    artifacts={stakeholders}
                    selectedIds={selectedIds}
                    onToggle={onToggle}
                />
                {(isLoading || hasNextPage) && (
                    <div ref={sentryRef} className="flex items-center justify-center py-3">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                )}
            </div>

            {selectedCount > 0 && (
                <div className="flex items-center justify-between px-6 py-4 bg-neutral-900">
                    <span className="text-sm font-medium text-white">{selectedCount} resources selected</span>
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="text-primary hover:text-primary/80 text-sm transition-colors cursor-pointer"
                    >
                        Deselect all
                    </button>
                </div>
            )}
        </>
    );
}

function Section({
    title,
    icon,
    artifacts,
    selectedIds,
    onToggle,
}: {
    title: string;
    icon: LucideIcon;
    artifacts: ArtifactDto[];
    selectedIds: string[];
    onToggle: (id: string) => void;
}) {
    if (artifacts.length === 0) return null;

    return (
        <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
            <div className="space-y-1.5">
                {artifacts.map((artifact) => (
                    <ArtifactListItem
                        key={artifact.id}
                        artifact={artifact}
                        icon={icon}
                        size="sm"
                        isSelected={selectedIds.includes(artifact.id)}
                        isShared={artifact.is_own === false}
                        shouldDisplayVersionInfo={false}
                        onClick={() => onToggle(artifact.id)}
                    />
                ))}
            </div>
        </div>
    );
}
