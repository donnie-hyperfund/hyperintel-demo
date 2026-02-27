'use client';

import type { ArtifactDto } from '@/lib/schema/artifact';
import { ArtifactListItem } from '@/modules/artifacts/components/artifact-list-item';
import { getArtifactChatId } from '@/modules/artifacts/utils';

type ResourceSectionProps = {
    title: string;
    basePath: string;
    artifacts: ArtifactDto[];
};

export function ResourceSection({ title, basePath, artifacts }: ResourceSectionProps) {
    if (artifacts.length === 0) return null;

    return (
        <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
            <div className="space-y-2">
                {artifacts.map((artifact) => {
                    const chatId = getArtifactChatId(artifact);
                    const href = chatId ? `${basePath}/${chatId}` : undefined;

                    return (
                        <ArtifactListItem
                            key={artifact.id}
                            size="sm"
                            artifact={artifact}
                            shouldDisplayVersionInfo={false}
                            href={href}
                        />
                    );
                })}
            </div>
        </div>
    );
}
