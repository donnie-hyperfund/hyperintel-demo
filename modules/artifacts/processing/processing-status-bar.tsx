'use client';

import { Check, XCircle } from 'lucide-react';
import { StatusBar, type StatusBarEntry } from '@/components/layouts/status-bar/status-bar';
import { ShimmerText } from '@/components/ui/shimmer-text';
import { useArtifactProcessing } from './artifact-processing-provider';
import type { ProcessingAction, ProcessingEntry, ProcessingStatus } from './types';

type LabelBuilder = (entry: ProcessingEntry, suffix: string) => string;
type LabelSet = Record<ProcessingStatus, LabelBuilder>;

const LABEL_BUILDERS: Record<ProcessingAction, LabelSet> = {
    approve: {
        processing: (entry, suffix) => `Approving ${entry.artifactName}${suffix}`,
        completed: (entry, suffix) => `${entry.artifactName} approved${suffix}`,
        failed: (entry, suffix) => `Failed to approve ${entry.artifactName}${suffix}`,
    },
    reject: {
        processing: (entry, suffix) => `Rejecting ${entry.artifactName}${suffix}`,
        completed: (entry, suffix) => `${entry.artifactName} rejected${suffix}`,
        failed: (entry, suffix) => `Failed to reject ${entry.artifactName}${suffix}`,
    },
    restore: {
        processing: (entry, suffix) => `Restoring ${entry.artifactName}${restoreVersions(entry, 'as')}${suffix}`,
        completed: (entry, suffix) =>
            `Restored ${entry.artifactName}${restoreVersions(entry, 'as proposed')}${suffix} — awaiting approval`,
        failed: (entry, suffix) => `Failed to restore ${entry.artifactName}${restoreVersions(entry, 'as')}${suffix}`,
    },
};

function restoreVersions(entry: ProcessingEntry, targetLabel: string): string {
    if (entry.action !== 'restore') return '';
    const source = ` v${entry.sourceVersionNumber}`;
    const target = entry.restoredVersionNumber != null ? ` ${targetLabel} v${entry.restoredVersionNumber}` : '';
    return `${source}${target}`;
}

function formatLocationSuffix(entry: ProcessingEntry): string {
    if (!entry.projectName) return '';
    const phaseLabel = entry.phaseName ?? (entry.phaseIndex != null ? `Phase ${entry.phaseIndex + 1}` : undefined);
    const location = phaseLabel ? `${entry.projectName}, ${phaseLabel}` : entry.projectName;
    return ` from ${location}`;
}

function formatLabel(entry: ProcessingEntry): string {
    const suffix = formatLocationSuffix(entry);
    return LABEL_BUILDERS[entry.action][entry.status](entry, suffix);
}

function toStatusBarEntry(entry: ProcessingEntry): StatusBarEntry {
    const label = formatLabel(entry);

    if (entry.status === 'completed') {
        return {
            id: entry.versionId,
            icon: <Check className="size-3.5 text-primary" />,
            content: <span>{label}</span>,
        };
    }
    if (entry.status === 'failed') {
        return {
            id: entry.versionId,
            icon: <XCircle className="size-3.5 text-destructive" />,
            content: <span>{label}</span>,
        };
    }

    return {
        id: entry.versionId,
        content: (
            <ShimmerText className="text-muted-foreground" duration={2.5}>
                {label}
            </ShimmerText>
        ),
    };
}

export function ProcessingStatusBar() {
    const { visibleEntries } = useArtifactProcessing();
    return (
        <div className="sticky top-0 z-50">
            <StatusBar entries={visibleEntries.map(toStatusBarEntry)} />
        </div>
    );
}
