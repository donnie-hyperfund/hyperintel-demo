import { useMemo } from 'react';

type TextSegment = { text: string; highlight: boolean };

const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

export function getHighlightSegments(text: string, query: string): TextSegment[] {
    const trimmed = query.trim();
    if (!trimmed) return [{ text, highlight: false }];

    const escaped = trimmed.replace(REGEX_SPECIAL_CHARS, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    const lowerQuery = trimmed.toLowerCase();

    return parts.filter(Boolean).map((part) => ({ text: part, highlight: part.toLowerCase() === lowerQuery }));
}

type HighlightTextProps = {
    text: string;
    query: string;
    highlightClassName?: string;
};

export function HighlightText({
    text,
    query,
    highlightClassName = 'bg-green-600/50 text-inherit rounded-0.5',
}: HighlightTextProps) {
    const segments = useMemo(() => getHighlightSegments(text, query), [text, query]);

    if (segments.length === 1 && !segments[0].highlight) {
        return <>{text}</>;
    }

    return (
        <>
            {segments.map((seg, i) =>
                seg.highlight ? (
                    <mark key={i} className={highlightClassName}>
                        {seg.text}
                    </mark>
                ) : (
                    seg.text
                ),
            )}
        </>
    );
}
