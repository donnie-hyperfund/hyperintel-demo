'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ControlButton } from './control-button';

type PageControlsProps = {
    currentPage: number;
    totalPages: number;
    onPreviousPage: () => void;
    onNextPage: () => void;
};

export function PageControls({ currentPage, totalPages, onPreviousPage, onNextPage }: PageControlsProps) {
    return (
        <div className="flex items-center gap-1">
            <Tooltip>
                <TooltipTrigger asChild>
                    <ControlButton onClick={onPreviousPage} disabled={currentPage <= 1}>
                        <ChevronLeft />
                    </ControlButton>
                </TooltipTrigger>
                <TooltipContent>Previous page</TooltipContent>
            </Tooltip>

            <span className="text-sm text-neutral-400 tabular-nums min-w-[3rem] text-center select-none">
                {currentPage} / {totalPages}
            </span>

            <Tooltip>
                <TooltipTrigger asChild>
                    <ControlButton onClick={onNextPage} disabled={currentPage >= totalPages}>
                        <ChevronRight />
                    </ControlButton>
                </TooltipTrigger>
                <TooltipContent>Next page</TooltipContent>
            </Tooltip>
        </div>
    );
}
