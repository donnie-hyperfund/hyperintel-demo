'use client';

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import {
	clearWsLog,
	downloadWsLog,
	getSnapshot,
	getWsLog,
	subscribe,
	type WsLogEntry,
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
	/** Number of children appended after endEntry was first set — highlights "late" events */
	lateCount: number;
};

type StandaloneEntry = {
	kind: 'standalone';
	entry: WsLogEntry;
};

type CollapsedStandalone = {
	kind: 'collapsed_standalone';
	id: number;
	event: string;
	direction: 'send' | 'recv';
	entries: WsLogEntry[];
};

type GroupedLogEntry = StreamGroup | StandaloneEntry;
type RenderRow = GroupedLogEntry | CollapsedStandalone;

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

/** Noisy events hidden by default — user can reveal via toolbar toggle. */
const NOISY_EVENTS = new Set(['update-session']);
const NOISY_STORAGE_KEY = 'dev:ws-log:show-noisy';

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

/** Deterministic JSON stringify — sorts object keys so property order doesn't affect equality. */
function stableStringify(v: unknown): string {
	if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
	if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
	const obj = v as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

const entrySigCache = new WeakMap<object, string>();
function entrySignature(entry: WsLogEntry): string {
	const d = entry.data;
	if (d !== null && typeof d === 'object') {
		const cached = entrySigCache.get(d as object);
		if (cached !== undefined) return cached;
		const sig = stableStringify(d);
		entrySigCache.set(d as object, sig);
		return sig;
	}
	return stableStringify(d);
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
					{group.lateCount > 0 && (
						<span className="ml-1 rounded bg-amber-900/40 px-1 py-0.5 text-[10px] font-medium text-amber-400">
							+{group.lateCount} late
						</span>
					)}
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
// Collapsed standalone run (consecutive identical top-level events)
// ---------------------------------------------------------------------------

function CollapsedStandaloneRow({ row }: { row: CollapsedStandalone }) {
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
				{directionIcon(row.direction)}
				<span
					className={cn(
						'shrink-0 font-medium',
						row.direction === 'send' ? 'text-blue-300' : 'text-green-300',
					)}
				>
					{row.event}
				</span>
				<span className="shrink-0 rounded bg-neutral-800 px-1 py-0.5 text-[10px] tabular-nums text-neutral-400">
					×{row.entries.length}
				</span>
			</button>
			{expanded && (
				<div className="border-t border-neutral-800/40">
					{row.entries.map((e) => (
						<LogEntry key={e.id} entry={e} indented />
					))}
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
	const [showNoisy, setShowNoisy] = useState(() => {
		if (typeof window === 'undefined') return false;
		try {
			return localStorage.getItem(NOISY_STORAGE_KEY) === '1';
		} catch {
			return false;
		}
	});
	const listRef = useRef<HTMLDivElement>(null);
	const pinRef = useRef(true);

	useEffect(() => {
		try {
			localStorage.setItem(NOISY_STORAGE_KEY, showNoisy ? '1' : '0');
		} catch {}
	}, [showNoisy]);

	const hiddenNoisyCount = useMemo(() => {
		if (showNoisy) return 0;
		return log.reduce((n, e) => (NOISY_EVENTS.has(e.event) ? n + 1 : n), 0);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot triggers recompute since log is mutated in place
	}, [snapshot, showNoisy]);

	const filtered = useMemo(() => {
		let out: WsLogEntry[] = log;
		if (!showNoisy) out = out.filter((e) => !NOISY_EVENTS.has(e.event));
		if (filter) {
			const lc = filter.toLowerCase();
			out = out.filter(
				(e) =>
					e.event.toLowerCase().includes(lc) ||
					e.direction.includes(lc),
			);
		}
		return out;
	// eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot triggers recompute since log is mutated in place
	}, [snapshot, filter, showNoisy]);

	const grouped = useMemo(() => {
		const result: GroupedLogEntry[] = [];
		// Persistent map by agentMessageId — entries are never removed, so late events
		// (arriving after stream_status) attach to the existing group instead of
		// spawning a new invalid one.
		const groupsById = new Map<string, StreamGroup>();

		const ensureGroup = (agentMessageId: string, entry: WsLogEntry): StreamGroup => {
			const existing = groupsById.get(agentMessageId);
			if (existing) return existing;

			const group: StreamGroup = {
				kind: 'stream',
				id: entry.id,
				startEntry: entry,
				children: [],
				agentMessageId,
				lateCount: 0,
			};
			groupsById.set(agentMessageId, group);
			result.push(group);
			return group;
		};

		const appendChild = (group: StreamGroup, entry: WsLogEntry) => {
			if (group.children[group.children.length - 1]?.id === entry.id) return;
			group.children.push(entry);
			if (group.endEntry) group.lateCount++;
		};

		for (const entry of filtered) {
			const data = entry.data as any;
			const id: string | undefined =
				typeof data?.agentMessageId === 'string' ? data.agentMessageId : undefined;

			if (entry.event === 'stream_started' && id) {
				appendChild(ensureGroup(id, entry), entry);
				continue;
			}

			// Mid-stream recovery: subscribe_response can attach to an already running stream
			if (entry.event === 'subscribe_response' && data?.status === 'streaming' && id) {
				appendChild(ensureGroup(id, entry), entry);
				continue;
			}

			if (entry.event === 'stream_event' && id) {
				appendChild(ensureGroup(id, entry), entry);
				continue;
			}

			if (entry.event === 'stream_status' && id) {
				const group = ensureGroup(id, entry);
				appendChild(group, entry);
				group.endEntry = entry;
				group.status = data.status;
				continue;
			}

			result.push({ kind: 'standalone', entry });
		}

		return result;
	// eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot needed: when filter is empty, filtered === log (stable ref)
	}, [snapshot, filter, showNoisy]);

	// Collapse consecutive runs of identical standalone events (same event + direction).
	const renderRows = useMemo<RenderRow[]>(() => {
		const out: RenderRow[] = [];
		let i = 0;
		while (i < grouped.length) {
			const item = grouped[i];
			if (item.kind !== 'standalone') {
				out.push(item);
				i++;
				continue;
			}

			const { event: evt, direction } = item.entry;
			const sig = entrySignature(item.entry);
			const runStart = i;
			while (i < grouped.length) {
				const g = grouped[i];
				if (
					g.kind === 'standalone' &&
					g.entry.event === evt &&
					g.entry.direction === direction &&
					entrySignature(g.entry) === sig
				) {
					i++;
				} else {
					break;
				}
			}
			const run = grouped.slice(runStart, i) as StandaloneEntry[];
			if (run.length >= 2) {
				out.push({
					kind: 'collapsed_standalone',
					id: run[0].entry.id,
					event: evt,
					direction,
					entries: run.map((r) => r.entry),
				});
			} else {
				out.push(run[0]);
			}
		}
		return out;
	}, [grouped]);

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
					onClick={() => setShowNoisy((v) => !v)}
					title={
						showNoisy
							? 'Hide noisy events (update-session, etc.)'
							: `Show noisy events${hiddenNoisyCount ? ` (${hiddenNoisyCount} hidden)` : ''}`
					}
					className={cn(
						'relative flex size-7 items-center justify-center rounded transition-colors hover:bg-neutral-800',
						showNoisy ? 'text-neutral-300' : 'text-neutral-500 hover:text-neutral-300',
					)}
				>
					{showNoisy ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
					{!showNoisy && hiddenNoisyCount > 0 && (
						<span className="absolute -top-1 -right-1 min-w-3.5 rounded-full bg-amber-500/80 px-1 text-center text-[9px] leading-[14px] font-medium text-neutral-950">
							{hiddenNoisyCount > 99 ? '99+' : hiddenNoisyCount}
						</span>
					)}
				</button>
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
				{renderRows.length === 0 ? (
					<p className="p-4 text-center text-xs text-neutral-600">
						{log.length === 0 ? 'No WebSocket events captured yet.' : 'No events match the filter.'}
					</p>
				) : (
					renderRows.map((item) => {
						if (item.kind === 'stream') return <StreamGroupRow key={item.id} group={item} />;
						if (item.kind === 'collapsed_standalone')
							return <CollapsedStandaloneRow key={`run-${item.id}`} row={item} />;
						return <LogEntry key={item.entry.id} entry={item.entry} />;
					})
				)}
			</div>
		</div>
	);
}
