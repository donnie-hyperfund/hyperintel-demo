export function useRotatingText(texts: string[], intervalMs: number, elapsedMs: number): string {
    if (texts.length === 0) return '';
    const index = Math.floor(elapsedMs / intervalMs) % texts.length;
    return texts[index];
}
