'use client';

import { X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    EMPTY_FILTERS,
    ProjectArtifactFilterDropdown,
    type ProjectArtifactFilters,
} from './project-artifact-filter-dropdown';
import { ProjectArtifactList } from './project-artifact-list';
import { ProjectArtifactUploadDocument } from './project-artifact-upload-document';

type ProjectArtifactsPanelProps = {
    onClose: () => void;
};

export default function ProjectArtifactsPanel({ onClose }: ProjectArtifactsPanelProps) {
    const [filters, setFilters] = useState<ProjectArtifactFilters>(EMPTY_FILTERS);

    const handleFilterChange = useCallback((next: ProjectArtifactFilters) => {
        setFilters(next);
    }, []);

    return (
        <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <h2 className="text-sm font-medium">Deliverables</h2>
                <div className="flex items-center gap-1">
                    <ProjectArtifactUploadDocument />
                    <ProjectArtifactFilterDropdown filters={filters} onChange={handleFilterChange} />
                    <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
                        <X className="size-4" />
                    </Button>
                </div>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto p-4">
                <ProjectArtifactList filters={filters} />
            </div>
        </div>
    );
}
