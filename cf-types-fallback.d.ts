// Fallback declarations for Cloudflare Workers global types used in workers/_common/.
// Root tsconfig doesn't include @cloudflare/workers-types, so these resolve the
// global type errors. Worker-specific tsconfigs have real CF types and won't see
// this file (their include is scoped to their own directories).

declare type ExecutionContext = any;
declare type ExportedHandler<E = any, Q = any, C = any> = any;
declare type MessageBatch = any;
declare type ScheduledController = any;
declare type ForwardableEmailMessage = any;
declare type DurableObjectNamespace = any;
declare type KVNamespace = any;
declare type Fetcher = any;
declare type Ai = any;
declare type DurableObjectState = any;
declare type DurableObjectStub = any;
declare interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
}
declare type WebSocketPair = any;
declare class WebSocketRequestResponsePair {
    constructor(request: string, response: string);
}
declare type SecretsStoreSecret = {
    get(): Promise<string>;
};

interface SubtleCrypto {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
}
