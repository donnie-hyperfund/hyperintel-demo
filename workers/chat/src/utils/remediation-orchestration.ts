import type { AgentConfig } from '@common/ai/agent/types';
import { looksLikeRemediationIntent } from './remediation-intent';

/** Injected into system prompt when remediation intent is detected. */
export const REMEDIATION_ORCHESTRATION_GUIDANCE = `QA REMEDIATION EXECUTION (mandatory for this turn): Apply all requested remediations in one economical path. Call begin_document(mode="edit") once. Use begin_document content and prior patch_document touched output as anchors — do NOT read_document between patches just to re-anchor. Batch every edit for the same snapshot into a single patch_document call with edits[]. Call finalize_document once when done. read_document is allowed at most twice and only if begin_document omitted needed content or touched does not cover the region. The read → patch → read → patch loop is a wasteful anti-pattern on large documents; it causes stream failures and extreme cost.`;

export const REMEDIATION_MAX_TOOL_CALLS = 14;
export const REMEDIATION_READ_DOCUMENT_LIMIT = 2;
export const REMEDIATION_PATCH_DOCUMENT_LIMIT = 4;

export const REMEDIATION_PER_TOOL_LIMITS: Record<string, number> = {
    read_document: REMEDIATION_READ_DOCUMENT_LIMIT,
    patch_document: REMEDIATION_PATCH_DOCUMENT_LIMIT,
};

const REMEDIATION_PER_TOOL_LIMIT_MESSAGE: Record<string, string> = {
    read_document:
        'read_document limit reached for this remediation turn. Use begin_document content and patch_document touched output as anchors, or batch remaining edits into one patch_document call.',
    patch_document:
        'patch_document limit reached for this remediation turn. Batch all remaining edits into one patch_document call with edits[], then finalize_document.',
};

export type RemediationRunConfig = {
    active: boolean;
    behavioralGuidance: readonly string[];
    agentConfigOverrides: Pick<
        AgentConfig,
        'maxToolCalls' | 'toolLimitBehavior' | 'toolLimitWarningThreshold' | 'perToolCallLimits'
    >;
};

export function buildRemediationRunConfig(message: string | null | undefined): RemediationRunConfig | null {
    if (!looksLikeRemediationIntent(message)) return null;

    return {
        active: true,
        behavioralGuidance: [REMEDIATION_ORCHESTRATION_GUIDANCE],
        agentConfigOverrides: {
            maxToolCalls: REMEDIATION_MAX_TOOL_CALLS,
            toolLimitBehavior: 'continue',
            toolLimitWarningThreshold: 4,
            perToolCallLimits: REMEDIATION_PER_TOOL_LIMITS,
        },
    };
}

export function remediationPerToolLimitMessage(toolName: string, max: number): string {
    return (
        REMEDIATION_PER_TOOL_LIMIT_MESSAGE[toolName] ??
        `Per-turn limit for ${toolName} reached (${max}). Batch remaining work or ask the user to continue in a follow-up message.`
    );
}
