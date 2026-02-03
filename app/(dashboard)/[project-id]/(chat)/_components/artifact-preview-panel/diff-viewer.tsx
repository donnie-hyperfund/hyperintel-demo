'use client';

import { useMemo } from 'react';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { cn } from '@/lib/utils';
import { computeDiff, type DiffBlock } from '@/modules/chat/utils/diff-utils';

type DiffViewerProps = {
    oldContent: string;
    newContent: string;
    className?: string;
};

/** Renders a block of changes with markdown formatting */
function DiffBlockView({ block }: { block: DiffBlock }) {
    if (!block.content.trim()) {
        return null;
    }

    if (block.type === 'unchanged') {
        return (
            <div className="diff-block diff-unchanged">
                <MarkdownRenderer markdown={block.content} />
            </div>
        );
    }

    if (block.type === 'added') {
        return (
            <div className="diff-block diff-added bg-green-950/30 border-l-2 border-green-500 pl-4 pr-4 -mr-4 -ml-4.5 py-3">
                <MarkdownRenderer markdown={block.content} diffType="diff-added" />
            </div>
        );
    }

    // Removed block
    return (
        <div className="diff-block diff-removed bg-red-950/30 border-l-2 border-red-500 pl-4 pr-4 -mr-4 -ml-4.5 py-3 opacity-60">
            <div className="line-through decoration-red-400/50">
                <MarkdownRenderer markdown={block.content} diffType="diff-removed" />
            </div>
        </div>
    );
}

/** Main diff viewer component - renders markdown with diff highlighting */
export function DiffViewer({ oldContent, newContent, className }: DiffViewerProps) {
    const { blocks, hasChanges } = useMemo(() => {
        const diff = computeDiff(oldContent, newContent);
        return { blocks: diff.blocks, hasChanges: diff.hasChanges };
    }, [oldContent, newContent]);

    if (!hasChanges) {
        return (
            <div className={cn('p-6', className)}>
                <MarkdownRenderer markdown={newContent} />
                <div className="mt-4 text-center text-sm text-neutral-500">No changes detected</div>
            </div>
        );
    }

    return (
        <div className={cn('p-6 space-y-4', className)}>
            {blocks.map((block, idx) => (
                <DiffBlockView key={idx} block={block} />
            ))}
        </div>
    );
}
