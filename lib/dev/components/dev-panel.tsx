'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { DevPanelTrigger } from './dev-panel-trigger';
import { WsLogTab } from './ws-log-tab';

const STORAGE_KEY = 'dev:panel-state';

type PanelState = { open: boolean; tab: string };

function loadState(): PanelState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return { open: false, tab: 'ws-logs' };
}

function saveState(state: PanelState) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {}
}

export function DevPanel() {
	const [state, setState] = useState<PanelState>({ open: false, tab: 'ws-logs' });
	const initialized = useRef(false);

	// Hydrate from localStorage after mount
	useEffect(() => {
		setState(loadState());
		initialized.current = true;
	}, []);

	// Persist state changes (skip the initial hydration)
	useEffect(() => {
		if (initialized.current) saveState(state);
	}, [state]);

	const toggle = useCallback(() => {
		setState((s) => ({ ...s, open: !s.open }));
	}, []);

	const close = useCallback(() => {
		setState((s) => ({ ...s, open: false }));
	}, []);

	const setTab = useCallback((tab: string) => {
		setState((s) => ({ ...s, tab }));
	}, []);

	// Keyboard shortcut: Ctrl+Shift+D
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.ctrlKey && e.shiftKey && e.key === 'D') {
				e.preventDefault();
				toggle();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [toggle]);

	const panelClasses = useMemo(
		() =>
			cn(
				'fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl transition-transform duration-200 ease-in-out',
				state.open ? 'translate-x-0' : 'translate-x-full',
			),
		[state.open],
	);

	return (
		<>
			<DevPanelTrigger open={state.open} onToggle={toggle} />

			<div className={panelClasses} role="dialog" aria-label="Dev tools panel">
				{/* Header */}
				<div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
					<span className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">Dev Tools</span>
					<button
						type="button"
						onClick={close}
						aria-label="Close dev panel"
						className="flex size-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
					>
						<X className="size-3.5" />
					</button>
				</div>

				{/* Tabs */}
				<Tabs value={state.tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
					<TabsList className="mx-3 mt-2 w-auto">
						<TabsTrigger value="ws-logs">WS Logs</TabsTrigger>
					</TabsList>

					<TabsContent value="ws-logs" className="min-h-0 flex-1 p-3">
						<WsLogTab />
					</TabsContent>
				</Tabs>
			</div>
		</>
	);
}
