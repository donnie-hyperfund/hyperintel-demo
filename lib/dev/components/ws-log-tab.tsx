'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
	type WsLogEntry,
	clearWsLog,
	downloadWsLog,
	getSnapshot,
	getWsLog,
	subscribe,
} from '../features/ws-logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString('en-GB', { hour12: false, fractionalSecondDigits: 3 });
}

function directionIcon(dir: 'send' | 'recv') {
	return dir === 'send' ? (
		<ArrowUp className="size-3 text-blue-400" />
	) : (
		<ArrowDown className="size-3 text-green-400" />
	);
}

// ---------------------------------------------------------------------------
// Log entry row
// ---------------------------------------------------------------------------

function LogEntry({ entry }: { entry: WsLogEntry }) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="border-b border-neutral-800/60 text-[11px] last:border-b-0">
			<button
				type="button"
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-neutral-800/40"
				onClick={() => setExpanded((v) => !v)}
			>
				{expanded ? (
					<ChevronDown className="size-3 shrink-0 text-neutral-500" />
				) : (
					<ChevronRight className="size-3 shrink-0 text-neutral-500" />
				)}
				{directionIcon(entry.direction)}
				<span className="shrink-0 tabular-nums text-neutral-500">{formatTime(entry.timestamp)}</span>
				<span
					className={cn(
						'truncate font-medium',
						entry.direction === 'send' ? 'text-blue-300' : 'text-green-300',
					)}
				>
					{entry.event}
				</span>
			</button>
			{expanded && (
				<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all bg-neutral-900/60 px-3 py-2 font-mono text-[10px] text-neutral-400">
					{JSON.stringify(entry.data, null, 2)}
				</pre>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function WsLogTab() {
	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const log = getWsLog();

	const [filter, setFilter] = useState('');
	const listRef = useRef<HTMLDivElement>(null);
	const pinRef = useRef(true);

	const filtered = useMemo(() => {
		if (!filter) return log;
		const lc = filter.toLowerCase();
		return log.filter(
			(e) =>
				e.event.toLowerCase().includes(lc) ||
				e.direction.includes(lc),
		);
	}, [log, filter]);

	// Auto-scroll when pinned to bottom
	const scrollToBottom = useCallback(() => {
		const el = listRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, []);

	useEffect(() => {
		if (pinRef.current) scrollToBottom();
	}, [filtered.length, scrollToBottom]);

	// Detect manual scroll to unpin/re-pin
	const handleScroll = useCallback(() => {
		const el = listRef.current;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
		pinRef.current = atBottom;
	}, []);

	return (
		<div className="flex h-full flex-col gap-2">
			{/* Toolbar */}
			<div className="flex items-center gap-2">
				<input
					type="text"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Filter events…"
					className="h-7 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
				/>
				<span className="shrink-0 text-[10px] tabular-nums text-neutral-500">
					{filtered.length}
					{filter && ` / ${log.length}`}
				</span>
				<button
					type="button"
					onClick={downloadWsLog}
					title="Download log as JSON"
					className="flex size-7 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
				>
					<Download className="size-3.5" />
				</button>
				<button
					type="button"
					onClick={clearWsLog}
					title="Clear log"
					className="flex size-7 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
				>
					<Trash2 className="size-3.5" />
				</button>
			</div>

			{/* Log list */}
			<div
				ref={listRef}
				onScroll={handleScroll}
				className="min-h-0 flex-1 overflow-y-auto rounded border border-neutral-800 bg-neutral-950"
			>
				{filtered.length === 0 ? (
					<p className="p-4 text-center text-xs text-neutral-600">
						{log.length === 0 ? 'No WebSocket events captured yet.' : 'No events match the filter.'}
					</p>
				) : (
					filtered.map((entry) => <LogEntry key={entry.id} entry={entry} />)
				)}
			</div>
		</div>
	);
}
