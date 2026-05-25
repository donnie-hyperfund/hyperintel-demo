const CB_MEMORY_LOG_PREFIX = '[cb-memory-checkpoint]';

export function isCompletionBriefName(name?: string | null): boolean {
    return typeof name === 'string' && name.toLowerCase().includes('completion-brief');
}

export function isCompletionBriefRequest(message?: string | null): boolean {
    return typeof message === 'string' && /completion\s+brief/i.test(message);
}

function safePayload(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    );
}

export function logCbMemoryCheckpoint(stage: string, payload: Record<string, unknown> = {}): void {
    console.log(CB_MEMORY_LOG_PREFIX, JSON.stringify(safePayload({ stage, ...payload })));
}

export function approxTextChars(value: unknown): number {
    if (typeof value === 'string') return value.length;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + approxTextChars(item), 0);
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).reduce((sum, item) => sum + approxTextChars(item), 0);
    }
    return 0;
}
