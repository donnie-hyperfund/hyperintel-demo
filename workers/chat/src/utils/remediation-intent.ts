/**
 * Detect user messages that request bulk QA remediation on a document.
 * Used to enable batched-edit orchestration (caps + guidance) in chat-handler.
 */

const REMEDIATION_INTENT_PATTERNS = [
    /\bapply\s+(all\s+)?(qa\s+)?remediat/i,
    /\bsurgically\s+(apply\s+)?(all\s+)?remediat/i,
    /\b(all|every)\s+(qa\s+)?(finding|remediat)/i,
    /\bremediat(e|ing)\s+(all|every)\b/i,
    /\bapply\s+all\s+(qa\s+)?finding/i,
    /\bone\s+at\s+a\s+time\b.*\b(finding|remediat)/i,
    /\b(finding|remediat).*\bone\s+at\s+a\s+time\b/i,
];

export function looksLikeRemediationIntent(message: string | null | undefined): boolean {
    if (!message?.trim()) return false;
    return REMEDIATION_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}
