// Patterns that signal the user wants a Completion Brief or phase transition.
// Kept intentionally broad but anchored — catches natural phrasing without firing on loose words.
const CB_INTENT_PATTERNS = [
    /completion\s+brief/i,
    /\bCB\b/,
    /next\s+phase/i,
    /move\s+to\s+(the\s+)?next\s+phase/i,
    /generate\s+summary/i,
    /phase\s+transition/i,
    /wrap\s+up\s+(this\s+)?phase/i,
    /close\s+(out\s+)?(this\s+)?phase/i,
    /finish\s+(this\s+)?phase/i,
];

export function looksLikeCompletionBriefIntent(message: string | null | undefined): boolean {
    if (!message) return false;
    return CB_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}
