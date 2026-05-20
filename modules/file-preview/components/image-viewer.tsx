'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Toolbar } from './controls/toolbar';
import { ZoomControls } from './controls/zoom-controls';

const MIN_ZOOM = 25;
const MAX_ZOOM = 500;
const ZOOM_STEP = 25;
const DEFAULT_ZOOM = 100;
const WHEEL_ZOOM_SENSITIVITY = 0.5;
const RESIZE_DEBOUNCE_MS = 50;

type ImageViewerProps = {
    src: string;
    alt?: string;
    viewportGap?: number;
};

export function ImageViewer({ src, alt, viewportGap = 0 }: ImageViewerProps) {
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const pinchStartDistance = useRef<number | null>(null);
    const pinchStartZoom = useRef(DEFAULT_ZOOM);

    const clampZoom = useCallback((value: number) => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))), []);

    const scrollRatio = useRef({ x: 0.5, y: 0.5 });

    const captureScrollRatio = useCallback(() => {
        const s = scrollRef.current;
        if (!s) return;
        scrollRatio.current = {
            x: s.scrollWidth > s.clientWidth ? (s.scrollLeft + s.clientWidth / 2) / s.scrollWidth : 0.5,
            y: s.scrollHeight > s.clientHeight ? (s.scrollTop + s.clientHeight / 2) / s.scrollHeight : 0.5,
        };
    }, []);

    const handleZoomIn = useCallback(() => {
        captureScrollRatio();
        setZoom((z) => clampZoom(z + ZOOM_STEP));
    }, [clampZoom, captureScrollRatio]);

    const handleZoomOut = useCallback(() => {
        captureScrollRatio();
        setZoom((z) => clampZoom(z - ZOOM_STEP));
    }, [clampZoom, captureScrollRatio]);

    // Restore scroll position after zoom
    useEffect(() => {
        const s = scrollRef.current;
        if (!s) return;
        const { x, y } = scrollRatio.current;
        s.scrollLeft = x * s.scrollWidth - s.clientWidth / 2;
        s.scrollTop = y * s.scrollHeight - s.clientHeight / 2;
    }, [zoom]);

    // Debounced container size tracking
    useEffect(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;

        let timer: ReturnType<typeof setTimeout>;
        const observer = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                setContainerSize({ w: scroller.clientWidth, h: scroller.clientHeight });
            }, RESIZE_DEBOUNCE_MS);
        });

        setContainerSize({ w: scroller.clientWidth, h: scroller.clientHeight });
        observer.observe(scroller);

        return () => {
            clearTimeout(timer);
            observer.disconnect();
        };
    }, []);

    // Ctrl+wheel zoom
    useEffect(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;

        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            captureScrollRatio();
            const delta = -e.deltaY * WHEEL_ZOOM_SENSITIVITY;
            setZoom((z) => clampZoom(z + delta));
        };

        scroller.addEventListener('wheel', handleWheel, { passive: false });
        return () => scroller.removeEventListener('wheel', handleWheel);
    }, [clampZoom, captureScrollRatio]);

    // Touch pinch-to-zoom
    const handleTouchStart = useCallback(
        (e: React.TouchEvent) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStartDistance.current = Math.hypot(dx, dy);
                pinchStartZoom.current = zoom;
            }
        },
        [zoom],
    );

    const handleTouchMove = useCallback(
        (e: React.TouchEvent) => {
            if (e.touches.length !== 2 || pinchStartDistance.current === null) return;
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDistance = Math.hypot(dx, dy);
            const ratio = currentDistance / pinchStartDistance.current;
            captureScrollRatio();
            setZoom(clampZoom(pinchStartZoom.current * ratio));
        },
        [clampZoom, captureScrollRatio],
    );

    const handleTouchEnd = useCallback(() => {
        pinchStartDistance.current = null;
    }, []);

    const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }, []);

    const scale = zoom / 100;

    // Compute image dimensions from debounced container size
    let imgW: number | undefined;
    let imgH: number | undefined;
    if (naturalSize && containerSize) {
        const availW = containerSize.w - viewportGap * 2;
        const availH = containerSize.h - viewportGap * 2;
        const fitScale = Math.min(availW / naturalSize.w, availH / naturalSize.h, 1);
        imgW = naturalSize.w * fitScale * scale;
        imgH = naturalSize.h * fitScale * scale;
    }
    const isZoomedIn = imgW !== undefined && imgH !== undefined;

    return (
        <div className="relative h-full">
            <div
                ref={scrollRef}
                className="h-full overflow-auto grid place-items-center"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div
                    style={
                        isZoomedIn
                            ? {
                                  width: imgW,
                                  height: imgH,
                                  margin: 'auto',
                                  padding: viewportGap,
                                  boxSizing: 'content-box',
                              }
                            : {
                                  minHeight: '100%',
                                  minWidth: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: viewportGap,
                                  boxSizing: 'border-box',
                              }
                    }
                >
                    <img
                        src={src}
                        alt={alt ?? ''}
                        draggable={false}
                        className="select-none"
                        onLoad={handleImageLoad}
                        style={{
                            ...(isZoomedIn
                                ? { width: '100%', height: '100%' }
                                : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const }),
                            opacity: isZoomedIn ? 1 : 0,
                            transition: 'none',
                        }}
                    />
                </div>
            </div>
            <Toolbar>
                <ZoomControls
                    zoomPercent={zoom}
                    onZoomIn={handleZoomIn}
                    onZoomOut={handleZoomOut}
                    zoomInDisabled={zoom >= MAX_ZOOM}
                    zoomOutDisabled={zoom <= MIN_ZOOM}
                />
            </Toolbar>
        </div>
    );
}
