import type { WebsocketClient } from '@/lib/websocket/base';

// ============================================================================
// DEV HOOK EVENTS — type definitions live here so prod code can reference them
// ============================================================================

export type DevHookEvents = {
    'ws:created': { client: WebsocketClient };
    'ws:message': { direction: 'recv'; event: string; data: unknown; clientId?: string };
    'ws:send': { direction: 'send'; event: string; data: unknown; clientId?: string };
    'ws:error': { error: Error; clientId?: string };
    'ws:close': { code: number; reason: string; clientId?: string };
    'ws:connected': { clientId?: string };
};

// ============================================================================
// STUB — no-op by default, injected by lib/dev/dev-hooks.ts when present
// ============================================================================

type EmitFn = <K extends keyof DevHookEvents>(event: K, payload: DevHookEvents[K]) => void;

let emitter: EmitFn = () => {};

export function setDevHookEmitter(fn: EmitFn) {
    emitter = fn;
}

export function emitDevHook<K extends keyof DevHookEvents>(event: K, payload: DevHookEvents[K]) {
    emitter(event, payload);
}
