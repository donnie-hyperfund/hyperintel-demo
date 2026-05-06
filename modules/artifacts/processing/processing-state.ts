import type { ProcessingEntry, ProcessingEntryInput, ProcessingStage } from './types';

const STAGE_ORDER: Record<ProcessingStage, number> = {
    queued: 0,
    saving: 1,
    publishing: 2,
    indexing: 3,
    finalizing: 4,
};

type ProcessingEntries = Map<string, ProcessingEntry>;

type OperationPatch = Partial<ProcessingEntry>;

type ProgressPatch = {
    progress?: number;
    stage?: ProcessingStage;
    stageStartedAt?: number;
};

type StartOperationInput = {
    entries: ProcessingEntries;
    input: ProcessingEntryInput;
    now: number;
};

type MergeStartedEventInput = {
    entries: ProcessingEntries;
    incoming: ProcessingEntry | null;
    now: number;
};

type MergeProgressEventInput = {
    entries: ProcessingEntries;
    versionId: string;
    progress?: number;
    stage?: ProcessingStage;
    fallbackEntry?: ProcessingEntry | null;
    now: number;
};

type CompleteOperationInput = {
    entries: ProcessingEntries;
    versionId: string;
    patch?: OperationPatch;
    fallbackEntry?: ProcessingEntry | null;
    now: number;
};

type FailOperationInput = {
    entries: ProcessingEntries;
    versionId: string;
    patch?: OperationPatch;
    fallbackEntry?: ProcessingEntry | null;
    now: number;
};

type RemoveOperationInput = {
    entries: ProcessingEntries;
    versionId: string;
};

type PruneExpiredOperationsInput = {
    entries: ProcessingEntries;
    now: number;
    thresholdMs: number;
};

export function clampProgress(progress: number | undefined, max = 99): number | undefined {
    if (progress == null || Number.isNaN(progress)) return undefined;
    return Math.max(0, Math.min(max, Math.round(progress)));
}

function getLatestStage({
    existingStage,
    incomingStage,
}: {
    existingStage: ProcessingStage | undefined;
    incomingStage: ProcessingStage | undefined;
}): ProcessingStage | undefined {
    if (!incomingStage) return existingStage;
    if (!existingStage) return incomingStage;
    return STAGE_ORDER[incomingStage] >= STAGE_ORDER[existingStage] ? incomingStage : existingStage;
}

function isTerminalEntry(entry: ProcessingEntry): boolean {
    return entry.status === 'completed' || entry.status === 'failed';
}

function cloneWithEntry(entries: ProcessingEntries, entry: ProcessingEntry): Map<string, ProcessingEntry> {
    const next = new Map(entries);
    next.set(entry.versionId, entry);
    return next;
}

function withNormalizedProgress(input: ProgressPatch): ProgressPatch {
    return {
        ...input,
        progress: clampProgress(input.progress),
    };
}

function mergeProgressPatch({
    existing,
    incoming,
    now,
}: {
    existing: ProcessingEntry;
    incoming: ProgressPatch;
    now: number;
}): ProgressPatch {
    const normalizedIncoming = withNormalizedProgress(incoming);
    const stage = getLatestStage({ existingStage: existing.stage, incomingStage: normalizedIncoming.stage });
    const stageStartedAt =
        stage && stage !== existing.stage ? (normalizedIncoming.stageStartedAt ?? now) : existing.stageStartedAt;
    const progress =
        normalizedIncoming.progress != null
            ? Math.max(existing.progress ?? 0, normalizedIncoming.progress)
            : existing.progress;

    return {
        progress,
        stage,
        stageStartedAt,
    };
}

function buildStartedEntry({ input, now }: { input: ProcessingEntryInput; now: number }): ProcessingEntry {
    const progress = clampProgress(input.progress);
    const stageStartedAt = input.stage ? (input.stageStartedAt ?? now) : input.stageStartedAt;

    return {
        ...input,
        ...(progress != null ? { progress } : {}),
        ...(stageStartedAt != null ? { stageStartedAt } : {}),
        status: 'processing',
        startedAt: now,
        initiatedLocally: true,
    } as ProcessingEntry;
}

function normalizeIncomingEntry({ incoming, now }: { incoming: ProcessingEntry; now: number }): ProcessingEntry {
    const progress = clampProgress(incoming.progress);
    const stageStartedAt = incoming.stage ? (incoming.stageStartedAt ?? now) : incoming.stageStartedAt;

    return {
        ...incoming,
        ...(progress != null ? { progress } : {}),
        ...(stageStartedAt != null ? { stageStartedAt } : {}),
        status: 'processing',
        startedAt: incoming.startedAt || now,
    } as ProcessingEntry;
}

function mergeStartedEntry({
    existing,
    incoming,
    now,
}: {
    existing: ProcessingEntry;
    incoming: ProcessingEntry;
    now: number;
}): ProcessingEntry {
    const progressPatch = mergeProgressPatch({
        existing,
        incoming: {
            progress: incoming.progress,
            stage: incoming.stage,
            stageStartedAt: incoming.stageStartedAt,
        },
        now,
    });

    return {
        ...existing,
        artifactId: incoming.artifactId || existing.artifactId,
        artifactName: incoming.artifactName || existing.artifactName,
        projectId: incoming.projectId ?? existing.projectId,
        projectName: incoming.projectName ?? existing.projectName,
        phaseName: incoming.phaseName ?? existing.phaseName,
        phaseIndex: incoming.phaseIndex ?? existing.phaseIndex,
        chatId: incoming.chatId ?? existing.chatId,
        ...progressPatch,
    } as ProcessingEntry;
}

export function startOperation({ entries, input, now }: StartOperationInput): Map<string, ProcessingEntry> {
    return cloneWithEntry(entries, buildStartedEntry({ input, now }));
}

export function mergeStartedEvent({ entries, incoming, now }: MergeStartedEventInput): Map<string, ProcessingEntry> {
    if (!incoming) return entries;

    const existing = entries.get(incoming.versionId);
    if (existing && isTerminalEntry(existing)) return entries;

    const normalizedIncoming = normalizeIncomingEntry({ incoming, now });
    if (!existing) return cloneWithEntry(entries, normalizedIncoming);

    return cloneWithEntry(entries, mergeStartedEntry({ existing, incoming: normalizedIncoming, now }));
}

export function mergeProgressEvent({
    entries,
    versionId,
    progress,
    stage,
    fallbackEntry,
    now,
}: MergeProgressEventInput): Map<string, ProcessingEntry> {
    const existing = entries.get(versionId);
    if (existing && isTerminalEntry(existing)) return entries;

    if (!existing) {
        return fallbackEntry
            ? cloneWithEntry(entries, normalizeIncomingEntry({ incoming: fallbackEntry, now }))
            : entries;
    }

    return cloneWithEntry(entries, {
        ...existing,
        ...mergeProgressPatch({ existing, incoming: { progress, stage, stageStartedAt: now }, now }),
    } as ProcessingEntry);
}

export function completeOperation({
    entries,
    versionId,
    patch,
    fallbackEntry,
    now,
}: CompleteOperationInput): Map<string, ProcessingEntry> {
    const existing = entries.get(versionId) ?? fallbackEntry;
    if (!existing || existing.status === 'failed') return entries;
    if (existing.status === 'completed') {
        return patch ? cloneWithEntry(entries, { ...existing, ...patch } as ProcessingEntry) : entries;
    }

    return cloneWithEntry(entries, {
        ...existing,
        ...patch,
        versionId,
        status: 'completed',
        completedAt: now,
        progress: 100,
        stage: patch?.stage ?? 'finalizing',
        stageStartedAt: patch?.stageStartedAt ?? now,
    } as ProcessingEntry);
}

export function failOperation({
    entries,
    versionId,
    patch,
    fallbackEntry,
    now,
}: FailOperationInput): Map<string, ProcessingEntry> {
    const existing = entries.get(versionId) ?? fallbackEntry;
    if (!existing || existing.status === 'completed') return entries;
    if (existing.status === 'failed') {
        return patch ? cloneWithEntry(entries, { ...existing, ...patch } as ProcessingEntry) : entries;
    }

    return cloneWithEntry(entries, {
        ...existing,
        ...patch,
        versionId,
        status: 'failed',
        completedAt: now,
    } as ProcessingEntry);
}

export function removeOperation({ entries, versionId }: RemoveOperationInput): Map<string, ProcessingEntry> {
    if (!entries.has(versionId)) return entries;

    const next = new Map(entries);
    next.delete(versionId);
    return next;
}

export function pruneExpiredOperations({
    entries,
    now,
    thresholdMs,
}: PruneExpiredOperationsInput): Map<string, ProcessingEntry> {
    const next = new Map(entries);
    let didRemoveEntry = false;

    for (const entry of entries.values()) {
        if (entry.status === 'processing' && now - entry.startedAt > thresholdMs) {
            next.delete(entry.versionId);
            didRemoveEntry = true;
        }
    }

    return didRemoveEntry ? next : entries;
}
