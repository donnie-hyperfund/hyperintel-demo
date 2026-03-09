'use client';

import { useCallback, useState } from 'react';
import { SidePanel } from '@/components/side-panel';
import {
    EMPTY_FILTERS,
    ProjectArtifactFilterDropdown,
    type ProjectArtifactFilters,
} from './project-artifact-filter-dropdown';
import { ProjectArtifactList } from './project-artifact-list';

type ProjectArtifactsPanelProps = {
    onClose: () => void;
};

export default function ProjectArtifactsPanel({ onClose }: ProjectArtifactsPanelProps) {
    const [filters, setFilters] = useState<ProjectArtifactFilters>(EMPTY_FILTERS);

    const handleFilterChange = useCallback((next: ProjectArtifactFilters) => {
        setFilters(next);
    }, []);

    return (
        <SidePanel
            title="Deliverables"
            onClose={onClose}
            actions={
                <ProjectArtifactFilterDropdown filters={filters} onChange={handleFilterChange} />
            }
        >
            <ProjectArtifactList filters={filters} />
        </SidePanel>
    );
}
