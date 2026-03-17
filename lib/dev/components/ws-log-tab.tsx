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
// Types
// ---------------------------------------------------------------------------

type StreamGroup = {
	kind: 'stream';
	id: number;
	startEntry: WsLogEntry;
	endEntry?: WsLogEntry;
	children: WsLogEntry[];
	agentMessageId: string;
	status?: string;
};

type StandaloneEntry = {
	kind: 'standalone';
	entry: WsLogEntry;
};

type GroupedLogEntry = StreamGroup | StandaloneEntry;

type CollapsedDelta = {
	kind: 'collapsed_deltas';
	eventType: string;
	entries: WsLogEntry[];
	count: number;
	mergedText: string;
	firstTimestamp: number;
	lastTimestamp: number;
};

type ChildRow = { kind: 'entry'; entry: WsLogEntry } | CollapsedDelta;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const ss = String(d.getSeconds()).padStart(2, '0');
	const ms = String(d.getMilliseconds()).padStart(3, '0');
	return `${hh}:${mm}:${ss}.${ms}`;
}

function directionIcon(dir: 'send' | 'recv') {
	return dir === 'send' ? (
		<ArrowUp className="size-3 text-blue-400" />
	) : (
		<ArrowDown className="size-3 text-green-400" />
	);
}

const statusColors: Record<string, string> = {
	done: 'bg-green-900/60 text-green-400',
	error: 'bg-red-900/60 text-red-400',
	aborted: 'bg-neutral-800 text-neutral-400',
};

// ---------------------------------------------------------------------------
// Inline event summaries
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

function getEventSummary(entry: WsLogEntry): { label: string; summary?: string } | null {
	if (entry.event !== 'stream_event') return null;
	const evt = (entry.data as any)?.event;
	if (!evt?.type) return null;

	const type: string = evt.type;
	switch (type) {
		case 'delta':
			return { label: 'delta', summary: evt.text ? truncate(evt.text, 80) : undefined };
		case 'reasoning_start':
			return { label: 'reasoning_start', summary: 'thinking…' };
		case 'reasoning_delta':
			return { label: 'reasoning_delta', summary: (evt.text || evt.content) ? truncate(evt.text ?? evt.content, 80) : undefined };
		case 'reasoning_done':
			return { label: 'reasoning_done', summary: evt.durationMs != null ? `${evt.durationMs}ms` : undefined };
		case 'tool_start':
			return { label: 'tool_start', summary: evt.tool ? `→ ${evt.tool}` : undefined };
		case 'tool_result':
			return { label: 'tool_result', summary: evt.success ? '✓' : '✗' };
		case 'search_start':
			return { label: 'search_start', summary: evt.query ? truncate(evt.query, 60) : undefined };
		case 'search_results':
			return { label: 'search_results', summary: evt.resultCount != null ? `${evt.resultCount} results` : undefined };
		case 'citation':
			return { label: 'citation', summary: evt.title ? `[${truncate(evt.title, 40)}]` : undefined };
		case 'document_start':
			return { label: 'document_start', summary: evt.title ?? undefined };
		case 'document_delta':
			return { label: 'document_delta', summary: evt.text?.length != null ? `${evt.text.length} chars` : undefined };
		case 'document_complete':
			return { label: 'document_complete', summary: evt.title ? `✓ ${evt.title}` : undefined };
		case 'done':
			return { label: 'done' };
		case 'error':
			return { label: 'error', summary: evt.message ?? evt.error ?? undefined };
		case 'created':
			return { label: 'created', summary: evt.id ?? undefined };
		default:
			return { label: type };
	}
}

// ---------------------------------------------------------------------------
// Log entry row
// ---------------------------------------------------------------------------

function LogEntry({ entry, indented }: { entry: WsLogEntry; indented?: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const eventInfo = indented ? getEventSummary(entry) : null;
	const displayName = eventInfo?.label ?? entry.event;

	return (
		<div className={cn('border-b border-neutral-800/60 text-[11px] last:border-b-0', indented && 'pl-4')}>
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
				<span
					className={cn(
						'shrink-0 font-medium',
						entry.direction === 'send' ? 'text-blue-300' : 'text-green-300',
					)}
				>
					{displayName}
				</span>
				{eventInfo?.summary && (
					<span className="truncate text-neutral-500">{eventInfo.summary}</span>
				)}
			</button>
			{expanded && (
				<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all bg-neutral-900/60 px-3 py-2 font-mono text-[10px] text-neutral-400">
					<span className="text-neutral-500">{formatTime(entry.timestamp)}</span>
					{entry.data != null && (
						<>
							{'\n'}
							{JSON.stringify(entry.data, null, 2)}
						</>
					)}
				</pre>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Delta collapsing
// ---------------------------------------------------------------------------

const DELTA_TYPES = new Set(['delta', 'reasoning_delta']);

function getInnerEventType(entry: WsLogEntry): string | undefined {
	return (entry.data as any)?.event?.type;
}

function getDeltaText(entry: WsLogEntry): string {
	const evt = (entry.data as any)?.event;
	return evt?.text ?? evt?.content ?? '';
}

function collapseChildren(children: WsLogEntry[]): ChildRow[] {
	const result: ChildRow[] = [];
	let i = 0;

	while (i < children.length) {
		const innerType = getInnerEventType(children[i]);

		if (innerType && DELTA_TYPES.has(innerType)) {
			const runType = innerType;
			const runStart = i;
			while (i < children.length && getInnerEventType(children[i]) === runType) {
				i++;
			}
			const run = children.slice(runStart, i);
			if (run.length >= 2) {
				result.push({
					kind: 'collapsed_deltas',
					eventType: runType,
					entries: run,
					count: run.length,
					mergedText: run.map(getDeltaText).join(''),
					firstTimestamp: run[0].timestamp,
					lastTimestamp: run[run.length - 1].timestamp,
				});
			} else {
				result.push({ kind: 'entry', entry: run[0] });
			}
		} else {
			result.push({ kind: 'entry', entry: children[i] });
			i++;
		}
	}

	return result;
}

function CollapsedDeltaRow({ row }: { row: CollapsedDelta }) {
	const [expanded, setExpanded] = useState(false);
	const preview = row.mergedText.length > 100 ? `${row.mergedText.slice(0, 100)}…` : row.mergedText;

	return (
		<div className="border-b border-neutral-800/60 pl-4 text-[11px] last:border-b-0">
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
				{directionIcon('recv')}
				<span className="shrink-0 font-medium text-green-300">{row.eventType}</span>
				<span className="shrink-0 rounded bg-neutral-800 px-1 py-0.5 text-[10px] tabular-nums text-neutral-400">
					×{row.count}
				</span>
				{preview && (
					<span className="truncate text-neutral-500">{preview}</span>
				)}
			</button>
			{expanded && (
				<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all bg-neutral-900/60 px-3 py-2 font-mono text-[10px] text-neutral-400">
					<span className="text-neutral-500">
						{formatTime(row.firstTimestamp)} → {formatTime(row.lastTimestamp)}
					</span>
					{'\n'}
					{row.mergedText}
				</pre>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Stream group row
// ---------------------------------------------------------------------------

function StreamGroupRow({ group }: { group: StreamGroup }) {
	const isStreaming = !group.endEntry;
	const userToggled = useRef(false);
	const [expanded, setExpanded] = useState(isStreaming);

	// Auto-collapse when stream completes (unless user manually toggled)
	const prevStreaming = useRef(isStreaming);
	useEffect(() => {
		if (prevStreaming.current && !isStreaming && !userToggled.current) {
			setExpanded(false);
		}
		prevStreaming.current = isStreaming;
	}, [isStreaming]);

	const handleToggle = useCallback(() => {
		userToggled.current = true;
		setExpanded((v) => !v);
	}, []);

	const collapsedChildren = useMemo(() => collapseChildren(group.children), [group.children]);

	return (
		<div className="border-b border-neutral-800/60 text-[11px] last:border-b-0">
			<button
				type="button"
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-neutral-800/40"
				onClick={handleToggle}
			>
				{expanded ? (
					<ChevronDown className="size-3 shrink-0 text-neutral-500" />
				) : (
					<ChevronRight className="size-3 shrink-0 text-neutral-500" />
				)}
				{directionIcon('recv')}
				{isStreaming ? (
					<span className="flex items-center gap-1.5 font-medium text-amber-400">
						<span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
						streaming…
					</span>
				) : (
					<span
						className={cn(
							'shrink-0 rounded px-1 py-0.5 text-[10px] font-medium',
							statusColors[group.status ?? ''] ?? 'bg-neutral-800 text-neutral-400',
						)}
					>
						{group.status ?? 'unknown'}
					</span>
				)}
				<span className="truncate text-neutral-400">
					Stream · {group.children.length} events
				</span>
			</button>
			{expanded && (
				<div className="border-t border-neutral-800/40">
					{collapsedChildren.map((child) =>
						child.kind === 'collapsed_deltas' ? (
							<CollapsedDeltaRow key={`delta-${child.entries[0].id}`} row={child} />
						) : (
							<LogEntry key={child.entry.id} entry={child.entry} indented />
						),
					)}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function WsLogTab() {
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
	// eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot triggers recompute since log is mutated in place
	}, [snapshot, filter]);

	const grouped = useMemo(() => {
		const result: GroupedLogEntry[] = [];
		const openStreams = new Map<string, StreamGroup>();

		const ensureOpenStream = (agentMessageId: string, entry: WsLogEntry): StreamGroup => {
			const existing = openStreams.get(agentMessageId);
			if (existing) return existing;

			const group: StreamGroup = {
				kind: 'stream',
				id: entry.id,
				startEntry: entry,
				children: [entry],
				agentMessageId,
			};
			openStreams.set(agentMessageId, group);
			result.push(group);
			return group;
		};

		for (const entry of filtered) {
			const data = entry.data as any;

			// Primary stream start signal
			if (entry.event === 'stream_started' && data?.agentMessageId) {
				const group = ensureOpenStream(data.agentMessageId, entry);
				if (group.children[group.children.length - 1]?.id !== entry.id) {
					group.children.push(entry);
				}
				continue;
			}

			// Mid-stream recovery: subscribe_response can attach to an already running stream
			if (
				entry.event === 'subscribe_response' &&
				data?.status === 'streaming' &&
				typeof data?.agentMessageId === 'string'
			) {
				const group = ensureOpenStream(data.agentMessageId, entry);
				if (group.children[group.children.length - 1]?.id !== entry.id) {
					group.children.push(entry);
				}
				continue;
			}

			// Stream events/status can arrive without a visible stream_started in this log window.
			// Create an implicit group so logs remain grouped by stream.
			if (entry.event === 'stream_event' && data?.agentMessageId) {
				const group = ensureOpenStream(data.agentMessageId, entry);
				if (group.children[group.children.length - 1]?.id !== entry.id) {
					group.children.push(entry);
				}
				continue;
			}

			if (entry.event === 'stream_status' && data?.agentMessageId) {
				const group = ensureOpenStream(data.agentMessageId, entry);
				if (group.children[group.children.length - 1]?.id !== entry.id) {
					group.children.push(entry);
				}
				group.endEntry = entry;
				group.status = data.status;
				openStreams.delete(data.agentMessageId);
				continue;
			}

			result.push({ kind: 'standalone', entry });
		}

		return result;
	// eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot needed: when filter is empty, filtered === log (stable ref)
	}, [snapshot, filter]);

	// Auto-scroll when pinned to bottom
	const scrollToBottom = useCallback(() => {
		const el = listRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, []);

	useEffect(() => {
		if (pinRef.current) scrollToBottom();
	}, [snapshot, scrollToBottom]);

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
				{grouped.length === 0 ? (
					<p className="p-4 text-center text-xs text-neutral-600">
						{log.length === 0 ? 'No WebSocket events captured yet.' : 'No events match the filter.'}
					</p>
				) : (
					grouped.map((item) =>
						item.kind === 'stream' ? (
							<StreamGroupRow key={item.id} group={item} />
						) : (
							<LogEntry key={item.entry.id} entry={item.entry} />
						),
					)
				)}
			</div>
		</div>
	);
}
