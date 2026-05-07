'use client';

import { ShimmerText } from '@/components/ui/shimmer-text';
import type { DocumentType } from '@/lib/schema/artifact';
import { ArtifactApprovalProgress } from './artifact-approval-progress';
import type { ArtifactOverlayState } from './use-artifact-overlay-state';

const OVERLAY_COPY: Record<'delete' | 'link' | 'updating', string> = {
    delete: 'Deleting…',
    link: 'Adding to Project Intel…',
    updating: 'Working on changes…',
};

type ArtifactPreviewOverlayProps = {
    state: NonNullable<ArtifactOverlayState>;
    documentType?: DocumentType;
    isInternal?: boolean;
    contentLength: number;
};

export function ArtifactPreviewOverlay({
    state,
    documentType,
    isInternal,
    contentLength,
}: ArtifactPreviewOverlayProps) {
    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-xs">
            {state.kind === 'approval' ? (
                <ArtifactApprovalProgress
                    action={state.action}
                    entry={state.entry}
                    documentType={documentType}
                    isInternal={isInternal}
                    contentLength={contentLength}
                />
            ) : (
                <ShimmerText className="text-md font-medium text-muted-foreground" duration={4}>
                    {OVERLAY_COPY[state.kind]}
                </ShimmerText>
            )}
        </div>
    );
}
