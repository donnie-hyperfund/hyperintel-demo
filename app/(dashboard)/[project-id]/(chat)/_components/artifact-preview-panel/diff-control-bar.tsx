'use client';

import { GitCompare, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DiffData } from '@/modules/chat/utils/diff-utils';

type DiffControlBarProps = {
    diffData: DiffData;
    isDiffVisible: boolean;
    onToggle: () => void;
};

export const DiffControlBar = ({ diffData, isDiffVisible, onToggle }: DiffControlBarProps) => {
    const { stats } = diffData;

    return (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-neutral-800 bg-neutral-900/50">
            <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1 text-green-400">
                    <Plus className="size-3.5" />
                    {stats.added} {stats.added === 1 ? 'line' : 'lines'} added
                </span>
                <span className="flex items-center gap-1 text-red-400">
                    <Minus className="size-3.5" />
                    {stats.removed} {stats.removed === 1 ? 'line' : 'lines'} removed
                </span>
            </div>
            <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className={cn(
                    'gap-2 text-xs h-7',
                    isDiffVisible
                        ? 'bg-neutral-700/50 text-neutral-200 hover:bg-neutral-700/70'
                        : 'text-neutral-400 hover:text-neutral-300',
                )}
            >
                <GitCompare className="size-3.5" />
                {isDiffVisible ? 'Hide changes' : 'View changes'}
            </Button>
        </div>
    );
};
