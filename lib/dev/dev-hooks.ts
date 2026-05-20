import { type DevHookEvents, setDevHookEmitter } from '@/lib/dev-hooks-stub';

// ============================================================================
// TYPED EVENT BUS — real implementation, only exists inside lib/dev/
// ============================================================================

type EventKey = keyof DevHookEvents;
type Listener<K extends EventKey> = (payload: DevHookEvents[K]) => void;

function createDevHooks() {
    const listeners = new Map<EventKey, Set<Listener<any>>>();

    return {
        on<K extends EventKey>(event: K, callback: Listener<K>): () => void {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(callback);
            return () => listeners.get(event)?.delete(callback);
        },

        off<K extends EventKey>(event: K, callback: Listener<K>): void {
            listeners.get(event)?.delete(callback);
        },

        emit<K extends EventKey>(event: K, payload: DevHookEvents[K]): void {
            listeners.get(event)?.forEach((cb) => {
                try {
                    cb(payload);
                } catch (e) {
                    console.error(`[devHooks] error in '${event}' listener:`, e);
                }
            });
        },
    };
}

export const devHooks = createDevHooks();

// Inject real emitter into the stub so prod call sites come alive
setDevHookEmitter(devHooks.emit);
