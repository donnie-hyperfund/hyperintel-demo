'use client';

import { Brain, Check, ChevronDown, ChevronRight, Loader2, Wrench, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { StreamBlock } from '@/common/ai/agent/types';
import { ShimmerText } from '@/components/ui/shimmer-text';
import { useThinkingLabel } from './use-thinking-label';

type DevelopmentThinkingBlockProps = {
    blocks: StreamBlock[];
    defaultExpanded: boolean;
    isStreaming?: boolean;
    status?: string;
};

export function DevelopmentThinkingBlock({
    blocks,
    defaultExpanded,
    isStreaming,
    status,
}: DevelopmentThinkingBlockProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const wasStreaming = useRef(isStreaming);
    const contentRef = useRef<HTMLDivElement>(null);
    const { doneLabel, isThinking } = useThinkingLabel(blocks, isStreaming);

    useEffect(() => {
        if (defaultExpanded) setExpanded(true);
    }, [defaultExpanded]);

    useEffect(() => {
        const container = contentRef.current;
        if (!container || !isStreaming) return;
        container.scrollTop = container.scrollHeight;
    }, [blocks, isStreaming]);

    useEffect(() => {
        if (wasStreaming.current && !isStreaming) {
            setExpanded(false);
        }
        wasStreaming.current = isStreaming;
    }, [isStreaming]);

    const handleClick = (e: React.MouseEvent) => {
        if (window.getSelection()?.toString()) return;
        if ((e.target as HTMLElement).closest('a, button')) return;
        setExpanded((prev) => !prev);
    };

    const label = isThinking && status ? status : isThinking ? 'Thinking' : doneLabel;

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: visual toggle, not critical interaction
        <div className="mb-2 overflow-hidden cursor-pointer text-muted-foreground/70" onClick={handleClick}>
            <div className="flex items-center gap-2 py-2 text-sm">
                <span className="font-medium">{isThinking ? <ShimmerText>{label}</ShimmerText> : label}</span>
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </div>

            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="relative mb-3">
                            <div
                                ref={contentRef}
                                className={`pb-3 pt-2 pr-4 space-y-3 overflow-y-auto ${isStreaming ? 'max-h-32' : 'max-h-48'}`}
                            >
                                {blocks.map((block) =>
                                    block.type === 'reasoning' ? (
                                        <ReasoningBubble key={block.id} content={block.content || ''} />
                                    ) : (
                                        <ToolCallBadge
                                            key={block.id}
                                            tool={(block as any).toolName}
                                            success={(block as any).toolSuccess}
                                        />
                                    ),
                                )}
                            </div>

                            <div className="pointer-events-none absolute bottom-0 left-0 right-4 h-3 bg-gradient-to-t from-neutral-975 to-transparent" />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ReasoningBubble({ content }: { content: string }) {
    if (!content.trim()) return null;

    return (
        <div className="flex gap-2 items-start">
            <Brain className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground/80 whitespace-pre-wrap">{content}</div>
        </div>
    );
}

function ToolCallBadge({ tool, success }: { tool: string; success?: boolean }) {
    const isRunning = success === undefined;

    return (
        <div className={`flex gap-2 items-center ${isRunning ? 'animate-pulse' : ''}`}>
            <Wrench className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-sm">{tool}</span>
            {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 text-neutral-400 animate-spin" />
            ) : success ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
                <X className="w-3.5 h-3.5 text-red-500" />
            )}
        </div>
    );
}
