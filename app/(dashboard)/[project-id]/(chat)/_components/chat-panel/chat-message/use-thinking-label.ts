import type { StreamBlock } from '@/common/ai/agent/types';

function formatSeconds(s: number): string {
    const rounded = Math.round(s * 10) / 10;
    return rounded % 1 === 0 ? `${rounded}` : `${rounded.toFixed(1)}`;
}

function formatDuration(ms: number): string | null {
    if (ms <= 0) return null;
    const totalSeconds = ms / 1000;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins > 0) return secs >= 0.05 ? `${mins}m ${formatSeconds(secs)}s` : `${mins}m`;
    return `${formatSeconds(secs)}s`;
}

type UseThinkingLabelOptions = {
    includeActions?: boolean;
};

export function useThinkingLabel(
    blocks: StreamBlock[],
    isStreaming?: boolean,
    { includeActions = true }: UseThinkingLabelOptions = {},
) {
    const actionSuffix = includeActions
        ? (() => {
              const c = blocks.filter((b) => b.type === 'tool_call').length;
              return c > 0 ? ` + ${c} action${c > 1 ? 's' : ''}` : '';
          })()
        : '';

    const totalReasoningMs = blocks
        .filter((b) => b.type === 'reasoning')
        .reduce((sum, b) => sum + (b.durationMs ?? 0), 0);

    const formattedDuration = formatDuration(totalReasoningMs);
    const doneLabel = formattedDuration ? `Thought for ${formattedDuration}${actionSuffix}` : `Thinking${actionSuffix}`;

    return { doneLabel, isThinking: !!isStreaming };
}
