export type ContextGateDetails = {
    gate: 'warning' | 'hard';
    /**
     * Why this gate fired.
     * - `'estimator'`: local request-time estimate hit the threshold.
     * - `'provider_error'`: a previous turn was provider-classified as context-length.
     * - `'provider_usage'`: provider-derived usage exceeded the threshold.
     * - `'already_transitioned'`: the source chat already has a next-phase chat,
     *   so phase transition / forced brief is not applicable. Token math is not
     *   the cause; `limitTokens` and `estimatedTokens` are omitted in this case.
     */
    source: 'estimator' | 'provider_error' | 'provider_usage' | 'already_transitioned';
    estimatedTokens?: number;
    /** Threshold the request hit. Omitted for `source: 'already_transitioned'` (no token math). */
    limitTokens?: number;
    canBypass: boolean;
    canForceBrief: boolean;
    /**
     * When `source: 'already_transitioned'`, the id of the next-phase chat the
     * FE should navigate to. Absent for token-driven gates.
     */
    existingNextChatId?: string;
};

const GATE_MESSAGES: Record<ContextGateDetails['gate'], string> = {
    warning:
        'You are approaching context window limits, quality can deteriorate, do you want to continue or generate completion brief and go to next phase? If you continue a completion brief may be forced at some point if you exceed context capacity.',
    hard: 'You have reached the context limit for this phase. Would you like to create a Completion Brief and move to the next phase?',
};

const ALREADY_TRANSITIONED_MESSAGE =
    'You have reached the context limit for this phase, but a new Completion Brief cannot be generated because this phase has already transitioned to the next phase. Continue in the next phase chat.';

export function buildContextGateError(details: ContextGateDetails): {
    code: 'CONTEXT_TOO_LONG';
    message: string;
    details: ContextGateDetails;
} {
    const message =
        details.source === 'already_transitioned' ? ALREADY_TRANSITIONED_MESSAGE : GATE_MESSAGES[details.gate];
    return {
        code: 'CONTEXT_TOO_LONG',
        message,
        details,
    };
}
