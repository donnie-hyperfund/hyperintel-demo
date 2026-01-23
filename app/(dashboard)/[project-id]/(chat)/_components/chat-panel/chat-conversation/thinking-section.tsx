'use client';

import { Brain, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StreamBlock } from '@/common/ai/agent/types';

function ReasoningBubble({ content }: { content: string }) {
    if (!content.trim()) return null;

    return (
        <div className="flex gap-2 items-start">
            <Brain className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground/80 whitespace-pre-wrap">{content}</div>
        </div>
    );
}

function ToolCallBadge({ tool, result, success }: { tool: string; result?: any; success?: boolean }) {
    const statusIcon = success === undefined ? '⏳' : success ? '✓' : '✗';
    const statusColor = success === undefined ? 'text-yellow-500' : success ? 'text-green-500' : 'text-red-500';

    return (
        <div className="flex gap-2 items-center">
            <Wrench className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{tool}</span>
            <span className={`text-sm ${statusColor}`}>{statusIcon}</span>
        </div>
    );
}

type ThinkingSectionProps = {
    blocks: StreamBlock[];
    defaultExpanded: boolean;
    isStreaming?: boolean;
    status?: string;
};

export function ThinkingSection({ blocks, defaultExpanded, isStreaming, status }: ThinkingSectionProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [shouldAnimate, setShouldAnimate] = useState(false);
    const wasStreaming = useRef(isStreaming);
    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-expand when defaultExpanded changes (streaming starts)
    useEffect(() => {
        if (defaultExpanded) setExpanded(true);
    }, [defaultExpanded]);

    // Auto-scroll content to bottom during streaming
    useEffect(() => {
        const container = contentRef.current;
        if (!container || !isStreaming) return;
        container.scrollTop = container.scrollHeight;
    }, [blocks, isStreaming]);

    // Auto-collapse with animation when streaming ends
    useEffect(() => {
        if (wasStreaming.current && !isStreaming) {
            // Streaming just ended - collapse with animation
            setShouldAnimate(true);
            // Small delay to let animation style apply before collapsing
            setTimeout(() => setExpanded(false), 50);
            // Clear animation flag after transition completes
            setTimeout(() => setShouldAnimate(false), 350);
        }
        wasStreaming.current = isStreaming;
    }, [isStreaming]);

    const handleToggle = () => {
        // Manual toggle - no animation
        setShouldAnimate(false);
        setExpanded((prev) => !prev);
    };

    const handleClick = (e: React.MouseEvent) => {
        // Don't toggle if user selected text
        if (window.getSelection()?.toString()) return;
        // Don't toggle if user clicked an interactive element
        if ((e.target as HTMLElement).closest('a, button')) return;
        handleToggle();
    };

    const toolCount = blocks.filter((b) => b.type === 'tool_call').length;
    const actionSuffix = toolCount > 0 ? ` + ${toolCount} action${toolCount > 1 ? 's' : ''}` : '';

    // Calculate total reasoning duration from reasoning blocks
    const reasoningBlocks = blocks.filter((b) => b.type === 'reasoning');
    const totalReasoningMs = reasoningBlocks.reduce((sum, b) => sum + (b.durationMs ?? 0), 0);

    // Format duration: "5s", "1m 5s", "0.3s" (decimals only if < 1s)
    const formatDuration = (ms: number): string | null => {
        if (ms <= 0) return null;
        const totalSeconds = ms / 1000;
        if (totalSeconds < 1) {
            return `${totalSeconds.toFixed(1)}s`;
        }
        const mins = Math.floor(totalSeconds / 60);
        const secs = Math.round(totalSeconds % 60);
        if (mins > 0) {
            return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
        }
        return `${secs}s`;
    };
    const formattedDuration = formatDuration(totalReasoningMs);

    // Build label: "Thought for 5s + 2 actions" or fallback to "Thinking + 2 actions"
    const thoughtLabel = formattedDuration
        ? `Thought for ${formattedDuration}${actionSuffix}`
        : `Thinking${actionSuffix}`;

    // Use status from backend while streaming, otherwise show thought duration
    const label = isStreaming && status ? status : thoughtLabel;

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: visual toggle, not critical interaction
        <div
            className="mb-2 ring-1 ring-border/50 rounded-lg overflow-hidden bg-muted/30 hover:bg-muted/50 cursor-pointer"
            onClick={handleClick}
        >
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className="font-medium">{label}</span>
            </div>

            <div
                ref={contentRef}
                className={`overflow-hidden ${shouldAnimate ? 'transition-all duration-300 ease-out' : ''}`}
                style={{
                    maxHeight: expanded ? '1000px' : '0',
                    opacity: expanded ? 1 : 0,
                }}
            >
                <div
                    ref={contentRef}
                    className={`px-3 pb-3 space-y-2 overflow-y-auto ${isStreaming ? 'max-h-32' : 'max-h-48'}`}
                >
                    {blocks.map((block) =>
                        block.type === 'reasoning' ? (
                            <ReasoningBubble key={block.id} content={block.content || ''} />
                        ) : (
                            <ToolCallBadge
                                key={block.id}
                                tool={(block as any).toolName}
                                result={(block as any).toolResult}
                                success={(block as any).toolSuccess}
                            />
                        ),
                    )}
                </div>
            </div>
        </div>
    );
}
