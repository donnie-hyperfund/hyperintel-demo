'use client';

import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { ShimmerText } from '@/components/ui/shimmer-text';
import type { DocumentType } from '@/lib/schema/artifact';
import type { ProcessingEntry } from '@/modules/artifacts/processing/types';
import { APPROVAL_STAGE_COPY } from './approval-progress-copy';
import { useApprovalProgress } from './use-approval-progress';
import { useRotatingText } from './use-rotating-text';

type ArtifactApprovalProgressProps = {
    entry?: ProcessingEntry;
    documentType?: DocumentType;
    contentLength: number;
};

export function ArtifactApprovalProgress({ entry, documentType, contentLength }: ArtifactApprovalProgressProps) {
    const { stage, progress, progressLabel, detailLabel } = useApprovalProgress({
        entry,
        documentType,
        contentLength,
    });
    const copy = APPROVAL_STAGE_COPY[stage];
    const detail = useRotatingText(copy.details, stage === 'generating-ai-content' ? 14_000 : 7000, stage);

    return (
        <div className="w-full max-w-sm space-y-4 px-6 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-border bg-background/40">
                <Loader2 className="size-5 animate-spin text-primary" />
            </div>

            <div className="space-y-1.5">
                <ShimmerText className="text-sm font-medium text-foreground" duration={2.4}>
                    {copy.headline}
                </ShimmerText>
                <p className="min-h-4 text-xs text-muted-foreground">{detail}</p>
            </div>

            <div className="space-y-2">
                <Progress value={progress} className="h-1.5" />
                <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{progressLabel}</span>
                    <span className="truncate">{detailLabel}</span>
                </div>
            </div>
        </div>
    );
}
