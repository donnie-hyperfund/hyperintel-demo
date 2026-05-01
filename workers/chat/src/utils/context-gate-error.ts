export type ContextGateDetails = {
    gate: 'warning' | 'hard';
    source: 'estimator' | 'provider_error' | 'provider_usage';
    estimatedTokens?: number;
    limitTokens: number;
    canBypass: boolean;
    canForceBrief: boolean;
};

const GATE_MESSAGES: Record<ContextGateDetails['gate'], string> = {
    warning:
        'You are approaching context window limits, quality can deteriorate, do you want to continue or generate completion brief and go to next phase? If you continue a completion brief may be forced at some point if you exceed context capacity.',
    hard: 'You have reached the context limit for this phase. Would you like to create a Completion Brief and move to the next phase?',
};

export function buildContextGateError(details: ContextGateDetails): {
    code: 'CONTEXT_TOO_LONG';
    message: string;
    details: ContextGateDetails;
} {
    return {
        code: 'CONTEXT_TOO_LONG',
        message: GATE_MESSAGES[details.gate],
        details,
    };
}
