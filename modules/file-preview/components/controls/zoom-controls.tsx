'use client';

import { Minus, Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ControlButton } from './control-button';

type ZoomControlsProps = {
    zoomPercent: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    zoomInDisabled?: boolean;
    zoomOutDisabled?: boolean;
};

export function ZoomControls({ zoomPercent, onZoomIn, onZoomOut, zoomInDisabled, zoomOutDisabled }: ZoomControlsProps) {
    return (
        <div className="flex items-center gap-1">
            <Tooltip>
                <TooltipTrigger asChild>
                    <ControlButton onClick={onZoomOut} disabled={zoomOutDisabled}>
                        <Minus />
                    </ControlButton>
                </TooltipTrigger>
                <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>

            <span className="text-sm text-neutral-400 tabular-nums min-w-[2.75rem] text-center select-none">
                {zoomPercent}%
            </span>

            <Tooltip>
                <TooltipTrigger asChild>
                    <ControlButton onClick={onZoomIn} disabled={zoomInDisabled}>
                        <Plus />
                    </ControlButton>
                </TooltipTrigger>
                <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>
        </div>
    );
}
