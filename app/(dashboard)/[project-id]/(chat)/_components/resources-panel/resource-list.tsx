'use client';

import { Building, Building2, Users } from 'lucide-react';
import { ArtifactItemSkeleton } from '@/app/(dashboard)/_components/artifact-list-item';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchResources } from '@/lib/api/client/hooks/use-resources';
import { ResourceSection } from './resource-section';

export function ResourceList() {
    const { companies, stakeholders, isLoading, error } = useFetchResources();

    if (isLoading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                    <ArtifactItemSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={Building2}
                    title="Failed to load resources"
                    error={error.message || 'An unexpected error occurred.'}
                />
            </div>
        );
    }

    const isEmpty = companies.length === 0 && stakeholders.length === 0;

    if (isEmpty) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={Building2}
                    title="No resources yet"
                    description="Companies & stakeholders will appear here once generated."
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <ResourceSection title="Companies" icon={Building} artifacts={companies} />
            <ResourceSection title="Stakeholders" icon={Users} artifacts={stakeholders} />
        </div>
    );
}
