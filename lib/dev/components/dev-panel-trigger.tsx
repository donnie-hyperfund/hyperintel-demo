'use client';

import { Wrench } from 'lucide-react';

type Props = {
	open: boolean;
	onToggle: () => void;
};

export function DevPanelTrigger({ open, onToggle }: Props) {

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-label={open ? 'Close dev panel' : 'Open dev panel'}
			className="fixed bottom-4 right-4 z-50 flex size-9 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 shadow-lg ring-1 ring-neutral-700 transition-colors hover:bg-neutral-700 hover:text-neutral-200"
		>
			<Wrench className="size-4" />
		</button>
	);
}
