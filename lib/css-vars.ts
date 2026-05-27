/**
 * Names are also used inline in Tailwind class strings (e.g. `top-(--processing-bar-height,0px)`).
 * Tailwind parses those literals at build time, so renaming a var here means grep-and-replacing
 * every class string too.
 */
export const CSS_VARS = {
    PROCESSING_BAR_HEIGHT: '--processing-bar-height',
    CHAT_FLOATING_CONTROLS_HEIGHT: '--chat-floating-controls-height',
} as const;

export type CssVar = (typeof CSS_VARS)[keyof typeof CSS_VARS];
