'use client';

import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { Scroller, ScrollPluginPackage } from '@embedpdf/plugin-scroll/react';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ZoomMode } from '@embedpdf/plugin-zoom';
import { ZoomGestureWrapper, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { PdfToolbar } from './pdf-toolbar';
import { TransparentRenderLayer } from './transparent-render-layer';

type PdfViewerProps = {
    src: string;
    viewportGap?: number;
};

export function PdfViewer({ src, viewportGap = 0 }: PdfViewerProps) {
    const { engine, isLoading: isEngineLoading } = usePdfiumEngine();

    const plugins = useMemo(
        () => [
            createPluginRegistration(DocumentManagerPluginPackage, {
                initialDocuments: [{ url: src }],
            }),
            createPluginRegistration(ViewportPluginPackage, { viewportGap }),
            createPluginRegistration(ScrollPluginPackage),
            createPluginRegistration(RenderPluginPackage),
            createPluginRegistration(ZoomPluginPackage, {
                defaultZoomLevel: ZoomMode.FitWidth,
                minZoom: 0.25,
                maxZoom: 5,
                zoomStep: 0.25,
            }),
        ],
        [src],
    );

    if (isEngineLoading || !engine) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <EmbedPDF engine={engine} plugins={plugins}>
            {({ activeDocumentId }) =>
                activeDocumentId && (
                    <DocumentContent documentId={activeDocumentId}>
                        {({ isLoading, isError, isLoaded }) => {
                            if (isLoading) {
                                return (
                                    <div className="flex h-full items-center justify-center">
                                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                                    </div>
                                );
                            }

                            if (isError) {
                                return (
                                    <div className="flex h-full items-center justify-center text-muted-foreground">
                                        Failed to load PDF
                                    </div>
                                );
                            }

                            if (!isLoaded) return null;

                            return (
                                <div className="relative h-full">
                                    <Viewport
                                        documentId={activeDocumentId}
                                        className="h-full"
                                        style={{ backgroundColor: 'transparent' }}
                                    >
                                        <ZoomGestureWrapper documentId={activeDocumentId}>
                                            <Scroller
                                                documentId={activeDocumentId}
                                                renderPage={({ width, height, pageIndex }) => (
                                                    <div style={{ width, height }}>
                                                        <TransparentRenderLayer
                                                            documentId={activeDocumentId}
                                                            pageIndex={pageIndex}
                                                        />
                                                    </div>
                                                )}
                                            />
                                        </ZoomGestureWrapper>
                                        <div className="h-12" />
                                    </Viewport>
                                    <PdfToolbar documentId={activeDocumentId} />
                                </div>
                            );
                        }}
                    </DocumentContent>
                )
            }
        </EmbedPDF>
    );
}
