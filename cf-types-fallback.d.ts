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
declare type DurableObjectStorage = any;
declare type WebSocketPair = any;
declare type WebSocketRequestResponsePair = any;

// Env is declared in each worker's worker-configuration.d.ts (excluded from root tsc).
// Fallback so chat worker source files (pulled in via app/(local) imports) compile.
declare interface Env {}

interface SubtleCrypto {
    timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean;
}
