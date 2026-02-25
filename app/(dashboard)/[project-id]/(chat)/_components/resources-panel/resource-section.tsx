'use client';

import type { LucideIcon } from 'lucide-react';
import { ArtifactListItem } from '@/app/(dashboard)/_components/artifact-list-item';
import type { ArtifactDto } from '@/lib/schema/artifact';

type ResourceSectionProps = {
    title: string;
    icon: LucideIcon;
    artifacts: ArtifactDto[];
};

export function ResourceSection({ title, icon: Icon, artifacts }: ResourceSectionProps) {
    if (artifacts.length === 0) return null;

    return (
        <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
            <div className="space-y-2">
                {artifacts.map((artifact) => (
                    <ArtifactListItem key={artifact.id} artifact={artifact} icon={Icon} onClick={() => {}} />
                ))}
            </div>
        </div>
    );
}
