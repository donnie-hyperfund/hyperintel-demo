'use client';

import type { DevSlotProps } from '@/lib/dev-slots';
import { devSlots } from '@/lib/dev/dev-slots';
import type { MessageMetadata } from '@/modules/chat/types';

type Props = DevSlotProps['message-actions'];

function MessageCost({ role, metadata }: Props) {
	if (role !== 'assistant' || !metadata?.usage) return null;

	const usage = metadata.usage as MessageMetadata['usage'];
	if (!usage) return null;

	const costText =
		usage.cost != null
			? `$${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(3)}`
			: `${(usage.inputTokens + usage.outputTokens).toLocaleString()} tok`;

	const lines: string[] = [];
	lines.push(`Input: ${usage.inputTokens.toLocaleString()} tokens`);
	lines.push(`Output: ${usage.outputTokens.toLocaleString()} tokens`);
	if (usage.reasoningTokens) lines.push(`Reasoning: ${usage.reasoningTokens.toLocaleString()} tokens`);
	if (usage.cacheReadTokens) lines.push(`Cache read: ${usage.cacheReadTokens.toLocaleString()} tokens`);
	if (usage.cacheWriteTokens) lines.push(`Cache write: ${usage.cacheWriteTokens.toLocaleString()} tokens`);

	if (usage.segments.length > 1 || usage.segments.some((s) => s.toolCalls?.length)) {
		lines.push('');
		lines.push('Breakdown:');
		for (let i = 0; i < usage.segments.length; i++) {
			const seg = usage.segments[i];
			const segCost = seg.cost != null ? ` ($${seg.cost.toFixed(4)})` : '';
			const segLabel = seg.toolCalls?.length ? 'tool turn' : 'response';
			lines.push(`  ${segLabel} #${i + 1}: ${(seg.inputTokens + seg.outputTokens).toLocaleString()} tok${segCost}`);
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
