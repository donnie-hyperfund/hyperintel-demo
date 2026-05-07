'use client';

import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { ShimmerText } from '@/components/ui/shimmer-text';
import type { DocumentType } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import type { ApprovalProcessingEntry } from '@/modules/artifacts/processing/types';
import { AnimatedApprovalText } from './animated-approval-text';
import { STAGE_COPY } from './approval-progress-copy';
import { useApprovalProgress } from './use-approval-progress';
import { usePulsedText } from './use-pulsed-text';
import { useRotatingText } from './use-rotating-text';

type ArtifactApprovalProgressProps = {
    action: 'approve' | 'reject';
    entry?: ApprovalProcessingEntry;
    documentType?: DocumentType;
    isInternal?: boolean;
    contentLength: number;
};

export function ArtifactApprovalProgress({
    action,
    entry,
    documentType,
    isInternal,
    contentLength,
}: ArtifactApprovalProgressProps) {
    const { stage, stageElapsedMs, progress, progressLabel, expectationLabel, paceLabel } = useApprovalProgress({
        entry,
        documentType,
        isInternal,
        contentLength,
    });
    const copy = STAGE_COPY[action][stage];
    const detail = useRotatingText(copy.details, 7000, stageElapsedMs);
    const expectation = usePulsedText({
        primaryText: expectationLabel,
        pulseText: paceLabel,
        pulseEveryMs: 9000,
        pulseVisibleMs: 2600,
        resetKey: `${stage}:${expectationLabel}:${paceLabel ?? ''}`,
    });

    const isReject = action === 'reject';

    return (
        <div className="w-full max-w-sm space-y-4 px-6 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-border bg-background/40">
                <Loader2 className={cn('size-5 animate-spin', isReject ? 'text-red-400/80' : 'text-primary')} />
            </div>

            <div className="space-y-1.5">
                <ShimmerText className="text-sm font-medium text-foreground" duration={2.4}>
                    {copy.headline}
                </ShimmerText>
                <AnimatedApprovalText
                    text={detail}
                    className="min-h-4 text-xs text-muted-foreground"
                    shimmerDuration={4}
                />
            </div>

            <div className="space-y-2">
                <Progress
                    value={progress}
                    className={cn('h-1.5', isReject && 'bg-zinc-600/40 *:data-[slot=progress-indicator]:bg-red-500/60')}
                />
                <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{progressLabel}</span>
                    <span className="min-w-0 flex-1 text-right">
                        <AnimatedApprovalText
                            as="span"
                            text={expectation.text}
                            className="block truncate"
                            shimmer={expectation.isPulse}
                            shimmerDuration={3}
                        />
                    </span>
                </div>
            </div>
        </div>
    );
}
