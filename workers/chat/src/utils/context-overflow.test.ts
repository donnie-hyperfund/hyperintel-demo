import type { ErrorClassification } from '@/common/ai';
import { describe, expect, it } from 'vitest';
import { CHAT_CONTEXT_HARD_LIMIT_TOKENS, CHAT_CONTEXT_WARNING_TOKENS } from './context-budget';
import { evaluateContextGate, maybeRecordContextOverflow, resolveContextOverflowGate } from './context-overflow';

const contextLength: ErrorClassification = { code: 'CONTEXT_TOO_LONG', retryable: false, kind: 'context_length' };
const incompleteResponse: ErrorClassification = {
    code: 'INCOMPLETE_RESPONSE',
    retryable: false,
    kind: 'output_truncated',
};
const networkError: ErrorClassification = { code: 'NETWORK_ERROR', retryable: true, kind: 'network' };

describe('maybeRecordContextOverflow', () => {
    it('stamps "soft" by default for context_length classification', () => {
        const chat = { metadata: {} as Record<string, unknown> };
        maybeRecordContextOverflow(chat, contextLength, 50_000);
        expect(chat.metadata.contextOverflow).toBe('soft');
    });

    it('stamps "hard" when estimated tokens already exceed the hard limit', () => {
        const chat = { metadata: {} as Record<string, unknown> };
        maybeRecordContextOverflow(chat, contextLength, CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1);
        expect(chat.metadata.contextOverflow).toBe('hard');
    });

    it('stamps "soft" when estimated tokens are between warning and hard', () => {
        const chat = { metadata: {} as Record<string, unknown> };
        maybeRecordContextOverflow(chat, contextLength, CHAT_CONTEXT_WARNING_TOKENS + 1);
        expect(chat.metadata.contextOverflow).toBe('soft');
    });

    it('stamps "soft" when estimatedTokens is undefined', () => {
        const chat = { metadata: {} as Record<string, unknown> };
        maybeRecordContextOverflow(chat, contextLength, undefined);
        expect(chat.metadata.contextOverflow).toBe('soft');
    });

    // A `stop_reason: 'max_tokens'` outcome is the runner's `output_truncated` / `INCOMPLETE_RESPONSE`
    // classification — it must NOT be treated as a context-window failure.
    it('does NOT stamp contextOverflow on INCOMPLETE_RESPONSE (output truncation / max_tokens)', () => {
        const chat = { metadata: {} as Record<string, unknown> };
        maybeRecordContextOverflow(chat, incompleteResponse, CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1);
        expect(chat.metadata.contextOverflow).toBeUndefined();
    });

    it('does NOT stamp contextOverflow on unrelated classifications (NETWORK_ERROR)', () => {
        const chat = { metadata: {} as Record<string, unknown> };
        maybeRecordContextOverflow(chat, networkError, 50_000);
        expect(chat.metadata.contextOverflow).toBeUndefined();
    });

    it('preserves other metadata fields when stamping', () => {
        const chat = { metadata: { loadedPrompts: ['pma/x'] } as Record<string, unknown> };
        maybeRecordContextOverflow(chat, contextLength, 50_000);
        expect(chat.metadata).toEqual({ loadedPrompts: ['pma/x'], contextOverflow: 'soft' });
    });

    it('handles null metadata by initializing it', () => {
        const chat = { metadata: null as Record<string, unknown> | null };
        maybeRecordContextOverflow(chat, contextLength, 50_000);
        expect(chat.metadata).toEqual({ contextOverflow: 'soft' });
    });

    it('handles missing metadata by initializing it', () => {
        const chat = {} as { metadata?: Record<string, unknown> | null };
        maybeRecordContextOverflow(chat, contextLength, 50_000);
        expect(chat.metadata).toEqual({ contextOverflow: 'soft' });
    });
});

describe('resolveContextOverflowGate', () => {
    it('estimator below warning + no metadata → none / estimator', () => {
        expect(resolveContextOverflowGate({ estimatedTokens: 50_000, metadataOverflow: undefined })).toEqual({
            level: 'none',
            source: 'estimator',
        });
    });

    it('estimator at warning threshold → soft / estimator', () => {
        expect(
            resolveContextOverflowGate({ estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS, metadataOverflow: undefined }),
        ).toEqual({ level: 'soft', source: 'estimator' });
    });

    it('estimator at hard threshold → hard / estimator', () => {
        expect(
            resolveContextOverflowGate({
                estimatedTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS,
                metadataOverflow: undefined,
            }),
        ).toEqual({ level: 'hard', source: 'estimator' });
    });

    it('metadata "soft" with low estimator → soft / provider_error', () => {
        expect(resolveContextOverflowGate({ estimatedTokens: 50_000, metadataOverflow: 'soft' })).toEqual({
            level: 'soft',
            source: 'provider_error',
        });
    });

    it('metadata "hard" with low estimator → hard / provider_error', () => {
        expect(resolveContextOverflowGate({ estimatedTokens: 50_000, metadataOverflow: 'hard' })).toEqual({
            level: 'hard',
            source: 'provider_error',
        });
    });

    it('estimator hard wins over metadata "soft" (stricter wins)', () => {
        expect(
            resolveContextOverflowGate({
                estimatedTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1,
                metadataOverflow: 'soft',
            }),
        ).toEqual({ level: 'hard', source: 'estimator' });
    });

    it('metadata "hard" wins over estimator "soft" (stricter wins)', () => {
        expect(
            resolveContextOverflowGate({
                estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS + 1,
                metadataOverflow: 'hard',
            }),
        ).toEqual({ level: 'hard', source: 'provider_error' });
    });

    it('ties resolve to estimator (estimator soft + metadata soft → estimator)', () => {
        expect(
            resolveContextOverflowGate({
                estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS + 1,
                metadataOverflow: 'soft',
            }),
        ).toEqual({ level: 'soft', source: 'estimator' });
    });

    it('ties resolve to estimator (estimator hard + metadata hard → estimator)', () => {
        expect(
            resolveContextOverflowGate({
                estimatedTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1,
                metadataOverflow: 'hard',
            }),
        ).toEqual({ level: 'hard', source: 'estimator' });
    });
});

describe('evaluateContextGate', () => {
    const baseInput = {
        estimatedTokens: 50_000,
        metadataOverflow: undefined,
        forceBrief: false,
        bypassContextWarning: false,
    } as const;

    it('returns null when no gate is reached', () => {
        expect(evaluateContextGate({ ...baseInput })).toBeNull();
    });

    it('fires the hard gate at hard threshold', () => {
        expect(
            evaluateContextGate({ ...baseInput, estimatedTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS }),
        ).toEqual({
            gate: 'hard',
            source: 'estimator',
            estimatedTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS,
            limitTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS,
            canBypass: false,
            canForceBrief: true,
        });
    });

    it('hard gate is waived by forceBrief', () => {
        expect(
            evaluateContextGate({
                ...baseInput,
                estimatedTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1,
                forceBrief: true,
            }),
        ).toBeNull();
    });

    it('hard gate ignores bypassContextWarning (only forceBrief waives it)', () => {
        const result = evaluateContextGate({
            ...baseInput,
            estimatedTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1,
            bypassContextWarning: true,
        });
        expect(result?.gate).toBe('hard');
    });

    it('fires the warning gate at warning threshold', () => {
        expect(
            evaluateContextGate({ ...baseInput, estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS }),
        ).toEqual({
            gate: 'warning',
            source: 'estimator',
            estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS,
            limitTokens: CHAT_CONTEXT_WARNING_TOKENS,
            canBypass: true,
            canForceBrief: true,
        });
    });

    it('warning gate is waived by bypassContextWarning', () => {
        expect(
            evaluateContextGate({
                ...baseInput,
                estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS + 1,
                bypassContextWarning: true,
            }),
        ).toBeNull();
    });

    it('warning gate is waived by forceBrief', () => {
        expect(
            evaluateContextGate({
                ...baseInput,
                estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS + 1,
                forceBrief: true,
            }),
        ).toBeNull();
    });

    it('reports source: provider_error when metadata is stricter than estimator', () => {
        const result = evaluateContextGate({ ...baseInput, metadataOverflow: 'hard' });
        expect(result?.source).toBe('provider_error');
        expect(result?.gate).toBe('hard');
    });
});

// TODO: integration test for the `done_ext` stream-teardown call site in chat-handler. The unit
// tests above cover `maybeRecordContextOverflow`'s logic (hard/soft branching, no-op on
// non-context classifications). End-to-end coverage of the runner emitting a `done_ext` with a
// context_length-classified error and the handler stamping the field would require mocking
// `runAgentStream` plus the prompt loader, posthog, safety, and pricing helpers — deferred.
