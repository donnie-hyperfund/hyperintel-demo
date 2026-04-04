'use client';

import type { ReactNode } from 'react';
import type { StreamBlock } from '@/lib/schema/stream';

/** Props forwarded to components registered in each named slot. */
export type DevSlotProps = {
	'message-actions': {
		chatId: string | null;
		messageId: string;
		content: string;
		role: 'user' | 'assistant';
		blocks?: StreamBlock[];
		feedbackScore?: boolean | null;
		feedbackComment?: string | null;
		metadata?: Record<string, unknown> | null;
	};
	'dev-panel': Record<string, never>;
	'chat-header': {
		chatId: string;
	};
};

export type DevSlotName = keyof DevSlotProps;

type RendererFn = (props: { name: DevSlotName } & Record<string, unknown>) => ReactNode;

let Renderer: RendererFn = () => null;

/** Called by lib/dev/dev-slots.tsx to inject the real implementation. */
export function setDevSlotRenderer(renderer: RendererFn) {
	Renderer = renderer;
}

/** Renders dev slot content. No-op until the real renderer is injected. */
export function DevSlot<K extends DevSlotName>(props: { name: K } & DevSlotProps[K]): ReactNode {
	return Renderer(props as { name: DevSlotName } & Record<string, unknown>);
}
