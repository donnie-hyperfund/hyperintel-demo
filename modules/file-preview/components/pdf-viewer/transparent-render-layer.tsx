'use client';

import { useDocumentState } from '@embedpdf/core/react';
import { ignore } from '@embedpdf/models';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useEffect, useRef, useState } from 'react';

/** RenderLayer alternative that passes transparentBackground to the engine. */
export function TransparentRenderLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
    const { provides: renderProvides } = useRenderCapability();
    const docState = useDocumentState(documentId);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const urlRef = useRef<string | null>(null);

    const scale = docState?.scale ?? 1;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const refreshVersion = docState?.pageRefreshVersions[pageIndex] ?? 0;

    useEffect(() => {
        if (!renderProvides) return;

        const task = renderProvides.forDocument(documentId).renderPage({
            pageIndex,
            options: { scaleFactor: scale, dpr, transparentBackground: true },
        });

        task.wait((blob) => {
            const url = URL.createObjectURL(blob);
            setImageUrl(url);
            urlRef.current = url;
        }, ignore);

        return () => {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            } else {
                task.abort({ code: 3, message: 'canceled render task' });
            }
        };
    }, [documentId, pageIndex, scale, dpr, renderProvides, refreshVersion]);

    if (!imageUrl) return null;

    return (
        <img
            src={imageUrl}
            onLoad={() => {
                if (urlRef.current) {
                    URL.revokeObjectURL(urlRef.current);
                    urlRef.current = null;
                }
            }}
            alt=""
            style={{ width: '100%', height: '100%' }}
        />
    );
}
