'use client';

import { useScroll } from '@embedpdf/plugin-scroll/react';
import { useZoom } from '@embedpdf/plugin-zoom/react';
import { PageControls } from '../controls/page-controls';
import { Toolbar } from '../controls/toolbar';
import { ToolbarDivider } from '../controls/toolbar-divider';
import { ZoomControls } from '../controls/zoom-controls';

export function PdfToolbar({ documentId }: { documentId: string }) {
    const { state: scrollState, provides: scroll } = useScroll(documentId);
    const { state: zoomState, provides: zoom } = useZoom(documentId);

    return (
        <Toolbar>
            <PageControls
                currentPage={scrollState.currentPage}
                totalPages={scrollState.totalPages}
                onPreviousPage={() => scroll?.scrollToPreviousPage()}
                onNextPage={() => scroll?.scrollToNextPage()}
            />
            <ToolbarDivider />
            <ZoomControls
                zoomPercent={Math.round(zoomState.currentZoomLevel * 100)}
                onZoomIn={() => zoom?.zoomIn()}
                onZoomOut={() => zoom?.zoomOut()}
            />
        </Toolbar>
    );
}
