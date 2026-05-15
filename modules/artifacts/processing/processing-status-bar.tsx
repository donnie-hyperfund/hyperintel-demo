'use client';

import { Ban, Check, History, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';
import { StatusBar, type StatusBarEntry } from '@/components/layouts/status-bar/status-bar';
import { ShimmerText } from '@/components/ui/shimmer-text';
import { SEARCH_PARAMS } from '@/lib/search-params';
import {
    useActiveArtifactStreams,
    useArtifactStreamMonitor,
} from '@/modules/artifacts/streaming/artifact-stream-monitor-provider';
import type { ActiveArtifactStream } from '@/modules/artifacts/streaming/types';
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

function formatProcessingLocationSuffix(entry: ProcessingEntry): string {
    if (!entry.projectName) return '';
    const phaseLabel = entry.phaseName ?? (entry.phaseIndex != null ? `Phase ${entry.phaseIndex + 1}` : undefined);
    const location = phaseLabel ? `${entry.projectName}, ${phaseLabel}` : entry.projectName;
    return ` from ${location}`;
}

function formatProcessingLabel(entry: ProcessingEntry): string {
    const suffix = formatProcessingLocationSuffix(entry);
    return LABEL_BUILDERS[entry.action][entry.status](entry, suffix);
}

const COMPLETED_ICON: Record<ProcessingAction, ReactNode> = {
    approve: <Check className="size-3.5 text-primary" />,
    reject: <Ban className="size-3.5 text-muted-foreground" />,
    restore: <History className="size-3.5 text-primary" />,
};

function toProcessingEntry(entry: ProcessingEntry): StatusBarEntry {
    const label = formatProcessingLabel(entry);

    if (entry.status === 'completed') {
        return {
            id: entry.versionId,
            icon: COMPLETED_ICON[entry.action],
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

function formatStreamLabel(stream: ActiveArtifactStream): string {
    if (stream.location.chatType !== 'phase') {
        return `Generating ${stream.artifactName}`;
    }

    const { phaseName, phaseIndex, projectName } = stream.location;
    const phaseLabel = phaseName ?? (phaseIndex != null ? `Phase ${phaseIndex + 1}` : undefined);
    const location = [projectName, phaseLabel].filter(Boolean).join(', ');
    return location ? `Generating ${stream.artifactName} — ${location}` : `Generating ${stream.artifactName}`;
}

function toStreamEntry(stream: ActiveArtifactStream, onNavigate: () => void): StatusBarEntry {
    return {
        id: `stream:${stream.chatId}:${stream.artifactKey}`,
        content: (
            <ShimmerText className="text-muted-foreground" duration={2.5}>
                {formatStreamLabel(stream)}
            </ShimmerText>
        ),
        onClick: onNavigate,
    };
}

function buildStreamArtifactHref(stream: ActiveArtifactStream): string | null {
    const params = new URLSearchParams();
    if (stream.previewTarget) {
        params.set(SEARCH_PARAMS.OPEN_ARTIFACT_KEY, stream.previewTarget.artifactKey);
        params.set(SEARCH_PARAMS.OPEN_ARTIFACT_VERSION, String(stream.previewTarget.version));
    }

    const query = params.toString();

    if (stream.location.projectId) {
        const path = `/${stream.location.projectId}/${stream.chatId}`;
        return query ? `${path}?${query}` : path;
    }
    if (stream.location.chatType === 'company') {
        const path = `/companies/${stream.chatId}`;
        return query ? `${path}?${query}` : path;
    }
    if (stream.location.chatType === 'stakeholder') {
        const path = `/stakeholders/${stream.chatId}`;
        return query ? `${path}?${query}` : path;
    }
    return null;
}

export function ProcessingStatusBar() {
    const { visibleEntries } = useArtifactProcessing();
    const activeStreams = useActiveArtifactStreams();
    const streamMonitor = useArtifactStreamMonitor();
    const router = useRouter();

    const entries = useMemo<StatusBarEntry[]>(
        () => [
            ...visibleEntries.map(toProcessingEntry),
            ...activeStreams.map((stream) =>
                toStreamEntry(stream, () => {
                    if (
                        stream.previewTarget &&
                        streamMonitor.tryActivate({
                            chatId: stream.chatId,
                            artifactKey: stream.previewTarget.artifactKey,
                            version: stream.previewTarget.version,
                        })
                    ) {
                        return;
                    }
                    const href = buildStreamArtifactHref(stream);
                    if (href) router.push(href);
                }),
            ),
        ],
        [visibleEntries, activeStreams, streamMonitor, router],
    );

    return (
        <div className="sticky top-0 z-50">
            <StatusBar entries={entries} mode="rotate" />
        </div>
    );
}
