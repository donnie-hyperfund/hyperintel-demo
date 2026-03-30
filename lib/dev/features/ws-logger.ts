import { devHooks } from '../dev-hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WsLogEntry = {
	id: number;
	timestamp: number;
	direction: 'send' | 'recv';
	event: string;
	data: unknown;
	clientId?: string;
};

// ---------------------------------------------------------------------------
// Token redaction
// ---------------------------------------------------------------------------

const SENSITIVE_KEY = /token|auth|secret|key|password|credential/i;

function redact(val: unknown): unknown {
	if (val === null || val === undefined) return val;
	if (Array.isArray(val)) return val.map(redact);
	if (typeof val === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
			out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v);
		}
		return out;
	}
	return val;
}

// ---------------------------------------------------------------------------
// Log store
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 1000;
const PING_PONG = new Set(['ping', 'pong']);

let nextId = 1;
const log: WsLogEntry[] = [];

function push(entry: Omit<WsLogEntry, 'id'>) {
	log.push({ ...entry, id: nextId++ });
	if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
	notifyListeners();
}

// ---------------------------------------------------------------------------
// Hook listeners
// ---------------------------------------------------------------------------

devHooks.on('ws:message', ({ event, data, clientId }) => {
	if (PING_PONG.has(event)) return;
	push({ timestamp: Date.now(), direction: 'recv', event, data: redact(data), clientId });
});

devHooks.on('ws:send', ({ event, data, clientId }) => {
	if (PING_PONG.has(event)) return;
	push({ timestamp: Date.now(), direction: 'send', event, data: redact(data), clientId });
});

devHooks.on('ws:connected', ({ clientId }) => {
	push({ timestamp: Date.now(), direction: 'recv', event: 'ws:connected', data: null, clientId });
});

devHooks.on('ws:close', ({ code, reason, clientId }) => {
	push({ timestamp: Date.now(), direction: 'recv', event: 'ws:close', data: { code, reason }, clientId });
});

devHooks.on('ws:error', ({ error, clientId }) => {
	push({
		timestamp: Date.now(),
		direction: 'recv',
		event: 'ws:error',
		data: { message: error.message, name: error.name },
		clientId,
	});
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getWsLog(): WsLogEntry[] {
	return log;
}

export function clearWsLog(): void {
	log.length = 0;
	notifyListeners();
}

export function downloadWsLog(): void {
	const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `ws-log-${Date.now()}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// useSyncExternalStore support
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = 0;

function notifyListeners() {
	snapshot++;
	for (const l of listeners) l();
}

export function subscribe(cb: Listener): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

export function getSnapshot(): number {
	return snapshot;
}
