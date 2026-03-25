import { useEffect } from 'react';

export function useThemeColor(color: string) {
    useEffect(() => {
        let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        const previous = meta?.content;

        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }

        meta.content = color;

        return () => {
            if (meta && previous !== undefined) {
                meta.content = previous;
            } else if (meta && previous === undefined) {
                meta.remove();
            }
        };
    }, [color]);
}
