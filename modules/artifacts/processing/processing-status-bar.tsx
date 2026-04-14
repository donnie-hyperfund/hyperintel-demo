'use client';

import { Check, XCircle } from 'lucide-react';
import { StatusBar, type StatusBarEntry } from '@/components/layouts/status-bar/status-bar';
import { ShimmerText } from '@/components/ui/shimmer-text';
import { useArtifactProcessing } from './artifact-processing-provider';
import type { ProcessingEntry } from './types';

function formatLocationSuffix(entry: ProcessingEntry): string {
    if (!entry.projectName) return '';
    const phaseLabel = entry.phaseName ?? (entry.phaseIndex != null ? `Phase ${entry.phaseIndex + 1}` : undefined);
    const location = phaseLabel ? `${entry.projectName}, ${phaseLabel}` : entry.projectName;
    return ` from ${location}`;
}

function formatLabel(entry: ProcessingEntry): string {
    const name = entry.artifactName;
    const suffix = formatLocationSuffix(entry);

    if (entry.status === 'completed') {
        const verb = entry.action === 'approve' ? 'approved' : 'rejected';
        return `${name} ${verb}${suffix}`;
    }
    if (entry.status === 'failed') {
        return `Failed to ${entry.action} ${name}${suffix}`;
    }

    const action = entry.action === 'approve' ? 'Approving' : 'Rejecting';
    return `${action} ${name}${suffix}`;
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
    return <StatusBar entries={visibleEntries.map(toStatusBarEntry)} />;
}
