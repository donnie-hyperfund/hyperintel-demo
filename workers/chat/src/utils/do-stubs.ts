// TODO with proper .d.ts this is not needed - but auto generated .d.ts misses imports -.-

/**
 * DO RPC stub interfaces for workers/chat handlers.
 *
 * Typed locally (not imported from the objects worker) because cross-worker
 * RPC is untyped at the CF boundary — these describe the calling interface only.
 * When CF d.ts generation is wired up, these can be replaced by the generated types.
 */

import type { StreamEvent } from '@/lib/schema/stream';

export interface UserGatewayStub {
    systemAction(topic: string, action: string, payload: unknown, previewAlias?: string): Promise<unknown>;
    broadcastToAll(message: unknown): Promise<void>;
}

export interface ChatStreamDOStub {
    push(events: StreamEvent[], seq: number): Promise<void>;
    done(): Promise<void>;
    abort(chatId?: string): Promise<void>;
    abortWait(): Promise<'abort' | 'timeout' | 'done'>;
    finalize(): Promise<void>;
}
