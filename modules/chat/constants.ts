export {
    CONTEXT_GATE_HARD_TOKENS,
    CONTEXT_GATE_WARNING_TOKENS,
    MAX_CONTEXT_TOKENS_UI,
} from '@/lib/constants/context-limits';

export const CONTEXT_THRESHOLDS = {
    caution: 70,
    critical: 90,
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
