'use client';

import type { DevSlotProps } from '@/lib/dev-slots';
import { devSlots } from '@/lib/dev/dev-slots';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';

type Props = DevSlotProps['message-actions'];

function MessageModelBadge({ role, metadata }: Props) {
	const { availablePresets } = useModelSelection();
	if (role !== 'assistant' || !metadata?.preset) return null;

	const presetId = metadata.preset as string;
	const inference = metadata.inference as
		| { paramsType?: string; model?: string; thinking?: boolean; thinkingBudget?: number }
		| undefined;
	const preset = availablePresets.find((p) => p.id === presetId);
	const label = preset?.label ?? presetId;

	const tooltipLines = [
		inference?.paramsType && `Provider: ${inference.paramsType}`,
		inference?.model && `Model: ${inference.model}`,
		inference?.thinking != null &&
			`Thinking: ${inference.thinking ? `on (${inference.thinkingBudget ?? '?'} budget)` : 'off'}`,
	]
		.filter(Boolean)
		.join('\n');

	return (
		<span
			className="ml-1 inline-flex items-center rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 select-none"
			title={tooltipLines}
		>
			{label}
		</span>
	);
}

// Register into the message-actions slot at module load
devSlots.register('message-actions', MessageModelBadge);
