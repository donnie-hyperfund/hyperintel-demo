'use client';

import { devSlots } from '@/lib/dev/dev-slots';
import type { DevSlotProps } from '@/lib/dev-slots';
import type { MessageMetadata } from '@/modules/chat/types';

type Props = DevSlotProps['message-actions'];

function formatUsd(n: number): string {
    return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
}

function MessageCost({ role, metadata }: Props) {
    if (role !== 'assistant' || !metadata?.usage) return null;

    const usage = metadata.usage as MessageMetadata['usage'];
    if (!usage) return null;

    const costText =
        usage.cost != null ? formatUsd(usage.cost) : `${(usage.inputTokens + usage.outputTokens).toLocaleString()} tok`;

    const warnings = new Set(usage.costWarnings ?? []);
    const cache = usage.cacheCost;

    const lines: string[] = [];
    if (usage.cacheReadTokens) {
        const total = usage.inputTokens + usage.cacheReadTokens;
        lines.push(
            `Input: ${usage.inputTokens.toLocaleString()} new + ${usage.cacheReadTokens.toLocaleString()} cached = ${total.toLocaleString()} total`,
        );
    } else {
        lines.push(`Input: ${usage.inputTokens.toLocaleString()} tokens`);
    }
    lines.push(`Output: ${usage.outputTokens.toLocaleString()} tokens`);
    if (usage.reasoningTokens) lines.push(`Reasoning: ${usage.reasoningTokens.toLocaleString()} tokens`);

    if (usage.cacheReadTokens) {
        const parts = [`Cache read: ${usage.cacheReadTokens.toLocaleString()} tok`];
        if (warnings.has('cache_read_rate_unknown')) {
            parts.push('⚠ rate unknown');
        } else if (cache?.readCost != null) {
            parts.push(`${formatUsd(cache.readCost)}`);
            if (cache.readSaved != null) parts.push(`(saved ${formatUsd(cache.readSaved)})`);
        }
        lines.push(parts.join(' — '));
    }
    if (usage.cacheWriteTokens) {
        const parts = [`Cache write (5m): ${usage.cacheWriteTokens.toLocaleString()} tok`];
        if (cache?.writeCost != null) parts.push(formatUsd(cache.writeCost));
        if (warnings.has('cache_write_rate_unknown')) parts.push('⚠ rate unknown (billed at base)');
        lines.push(parts.join(' — '));
    }
    if (usage.cacheWrite1hTokens) {
        const parts = [`Cache write (1h): ${usage.cacheWrite1hTokens.toLocaleString()} tok`];
        if (cache?.write1hCost != null) parts.push(formatUsd(cache.write1hCost));
        lines.push(parts.join(' — '));
    }

    if (usage.segments.length > 1 || usage.segments.some((s) => s.toolCalls?.length)) {
        lines.push('');
        lines.push('Breakdown:');
        for (let i = 0; i < usage.segments.length; i++) {
            const seg = usage.segments[i];
            const segCost = seg.cost != null ? ` ($${seg.cost.toFixed(4)})` : '';
            const segLabel = seg.toolCalls?.length ? 'tool turn' : 'response';
            lines.push(
                `  ${segLabel} #${i + 1}: ${(seg.inputTokens + seg.outputTokens).toLocaleString()} tok${segCost}`,
            );
            if (seg.toolCalls) {
                for (const tc of seg.toolCalls) {
                    const argumentTokens = tc.argumentTokens ?? tc.inputTokens ?? 0;
                    const resultTokens = tc.resultTokens ?? tc.outputTokens ?? 0;
                    const tcTok = argumentTokens + resultTokens;
                    const label = tc.usageLabel ? `${tc.toolName} (${tc.usageLabel})` : tc.toolName;
                    lines.push(
                        `    ${label}: ~${tcTok.toLocaleString()} tok (args ${argumentTokens.toLocaleString()}, result ${resultTokens.toLocaleString()})`,
                    );
                }
            }
        }
    }

    return (
        <span className="ml-1 text-[10px] text-amber-300/60 select-none" title={lines.join('\n')}>
            {costText}
        </span>
    );
}

devSlots.register('message-actions', MessageCost);
