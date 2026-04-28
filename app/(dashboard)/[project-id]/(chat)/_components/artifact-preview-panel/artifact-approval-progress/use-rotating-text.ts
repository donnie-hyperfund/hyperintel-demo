import { useEffect, useRef, useState } from 'react';

export function useRotatingText(texts: string[], intervalMs: number, key: string): string {
    const [index, setIndex] = useState(0);
    const textsRef = useRef(texts);
    textsRef.current = texts;

    useEffect(() => {
        setIndex(0);
    }, [key]);

    useEffect(() => {
        if (textsRef.current.length <= 1) return;
        const timer = setInterval(() => {
            setIndex((previousIndex) => (previousIndex + 1) % textsRef.current.length);
        }, intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs, key]);

    return texts[index % texts.length];
}
