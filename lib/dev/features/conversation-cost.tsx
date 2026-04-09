'use client';

import { devSlots } from '@/lib/dev/dev-slots';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

function ConversationCost() {
	const { state } = useChatContext();
	const rawCost = state.totalCost;

	if (rawCost == null) return null;

	// Postgres numeric(12,6) returns as string — coerce to number
	const totalCost = typeof rawCost === 'string' ? parseFloat(rawCost) : rawCost;
	if (isNaN(totalCost)) return null;

	const display = totalCost < 0.01 ? `$${totalCost.toFixed(4)}` : `$${totalCost.toFixed(3)}`;

	return (
		<span className="text-[10px] text-amber-300/60 select-none" title={`Total conversation cost: ${display}`}>
			{display}
		</span>
	);
}

devSlots.register('chat-footer', ConversationCost);
