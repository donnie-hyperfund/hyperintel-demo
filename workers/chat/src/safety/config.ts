const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);

export function isOutputSafetyEnabled(env: { CHAT_OUTPUT_SAFETY_ENABLED?: string }): boolean {
    const rawValue = env.CHAT_OUTPUT_SAFETY_ENABLED;
    if (!rawValue) return true;

    return !DISABLED_VALUES.has(rawValue.trim().toLowerCase());
}
