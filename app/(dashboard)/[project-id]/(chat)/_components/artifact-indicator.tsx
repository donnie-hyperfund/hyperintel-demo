'use client';

import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import type { MessageArtifactRef } from '@/modules/chat/types';

type ArtifactIndicatorProps = {
    artifactRef: MessageArtifactRef;
    className?: string;
};

export function ArtifactIndicator({ artifactRef, className }: ArtifactIndicatorProps) {
    const { currentArtifactId, setCurrentArtifact } = useArtifactContext();

    const isSelected = currentArtifactId === artifactRef.id;

    const handleClick = () => {
        setCurrentArtifact(isSelected ? null : artifactRef.id);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                'group relative w-full min-w-[280px] max-w-[400px] flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 text-left hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isSelected
                    ? 'bg-gradient-to-br from-green-500/14 via-green-500/10 to-neutral-500/12 border-green-400/35 shadow-sm shadow-green-400/8'
                    : 'bg-gradient-to-br from-green-500/6 via-green-500/4 to-neutral-500/5 border-neutral-200/5 hover:border-green-400/20',
                className,
            )}
        >
            {/* Gradient overlay on hover */}
            <div className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 bg-gradient-to-br from-green-500/4 to-neutral-500/5 group-hover:opacity-100" />

            {/* Icon container with gradient background */}
            <div className="relative shrink-0 size-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-green-600 to-emerald-500 shadow-sm shadow-green-400/15">
                <FileText className="size-5 text-white/95" strokeWidth={2} />
            </div>

            {/* Content */}
            <div className="relative flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold truncate text-foreground group-hover:text-green-500 transition-colors duration-200">
                        {artifactRef.title}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium">Document</span>
                    {isSelected && <span className="text-xs text-green-500 font-medium">• Open</span>}
                </div>
            </div>

            {/* Selection indicator */}
            {isSelected && <div className="absolute top-2 right-2 size-2 rounded-full bg-green-500" />}
        </button>
    );
}
