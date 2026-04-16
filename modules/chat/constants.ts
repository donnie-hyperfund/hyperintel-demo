export const MAX_CONTEXT_TOKENS = 200_000;

export const CONTEXT_THRESHOLDS = {
    caution: 60,
    critical: 80,
} as const;

export const intakeConfigMap = {
    company: {
        framework: 'cpf',
        category: 'principal',
    },
    stakeholder: {
        framework: 'hpf',
        category: 'principal',
    },
} as const;
