import { type CacheAdapter, EntityManager, MikroORM, Options } from '@mikro-orm/postgresql';
import { cache } from 'react';
import _ from 'underscore';
import config from '@/mikro-orm.config';
import staticConfig from '@/mikro-orm.static.config';

// Use globalThis for ORM promise so all modules share same reference across hot reloads
declare global {
    // eslint-disable-next-line no-var
    var __ormPromise: Promise<MikroORM> | null | undefined;
    // eslint-disable-next-line no-var,@typescript-eslint/no-explicit-any
    var ormCleanups: any[] | undefined;
    // eslint-disable-next-line no-var,@typescript-eslint/no-explicit-any
    var __ormMetadataCache: Record<string, any> | undefined;
}

/**
 * Cache adapter for surviving Next.js HMR decorator wipes.
 *
 * Turbopack/webpack may bundle all entities into a single chunk, so every
 * entity ends up with the same `path` value. Path-based indexing would
 * collapse them into one entry. Instead, we index by:
 *   1. className (primary) — MikroORM's main lookup key
 *   2. unique file paths (secondary) — only when paths are actually distinct
 */
class HmrMetadataCacheAdapter implements CacheAdapter {
    private byPath = new Map<string, any>();
    private byName = new Map<string, any>();

    constructor(options: { data: Record<string, any> }) {
        const pathCounts = new Map<string, number>();

        for (const [key, meta] of Object.entries(options.data)) {
            this.byName.set(key, meta);
            if (meta?.className) {
                this.byName.set(meta.className, meta);
            }
            if (meta?.path) {
                const normalized = meta.path.replace(/\.[jt]s$/, '');
                pathCounts.set(normalized, (pathCounts.get(normalized) ?? 0) + 1);
            }
        }

        // Only index by path when paths are unique (not bundled into one chunk)
        for (const [, meta] of Object.entries(options.data)) {
            if (meta?.path) {
                const normalized = meta.path.replace(/\.[jt]s$/, '');
                if (pathCounts.get(normalized) === 1) {
                    this.byPath.set(normalized, meta);
                }
            }
        }
    }

    get(name: string) {
        const key = name.replace(/\.[jt]s$/, '');
        return this.byName.get(key) ?? this.byPath.get(key) ?? undefined;
    }

    set(name: string, data: unknown, _origin: string) {
        const key = name.replace(/\.[jt]s$/, '');
        this.byName.set(key, data);
    }

    remove(name: string) {
        const key = name.replace(/\.[jt]s$/, '');
        this.byPath.delete(key);
        this.byName.delete(key);
    }

    clear() {
        this.byPath.clear();
        this.byName.clear();
    }
}

// Fix to not leak connections on local dev server
if (process.env.NODE_ENV === 'development') {
    if (globalThis.ormCleanups?.length) {
        globalThis.ormCleanups.forEach((ormCleanup) => ormCleanup());
        globalThis.ormCleanups = [];
    }
}

const reqStore = cache(() => ({ verified: false }));

/** Reuse the same EM fork within a single Next.js request (RSC / route handler / middleware). */
const getRequestFork = cache(async (): Promise<EntityManager> => {
    const orm = await globalThis.__ormPromise!;
    return orm.em.fork();
});

export function rawOrmGuard(verify: string) {
    if (verify !== "I know what I'm doing") throw new Error("You don't know what you're doing");
    reqStore().verified = true;
}

// raw does not auto-fork
export async function getOrm(): Promise<{ em: EntityManager }>;
export async function getOrm(raw: true): Promise<MikroORM>;
export async function getOrm(injectConfig?: Options): Promise<{ em: EntityManager }>;
export async function getOrm(injectConfig: Options, raw: true): Promise<MikroORM>;
export async function getOrm(
    injectConfigOrRaw: Options | boolean = false,
    raw = false,
): Promise<MikroORM | { em: EntityManager }> {
    let injectConfig: Options;
    if (_.isBoolean(injectConfigOrRaw)) {
        raw = injectConfigOrRaw;
        if (raw && !reqStore().verified) {
            throw new Error("You don't know what you're doing");
        }
        injectConfig = {};
    } else {
        injectConfig = injectConfigOrRaw ?? {};
    }

    if (!globalThis.__ormPromise) {
        const useStatic = !!process.env.VERCEL_ENV;
        let configToUse = useStatic ? staticConfig : config;

        // Survive Next.js HMR decorator-wipe by injecting cached metadata.
        // Uses a custom adapter (not GeneratedCacheAdapter) that re-keys by
        // source file path so identity map PK extraction works correctly.
        if (process.env.NODE_ENV === 'development' && globalThis.__ormMetadataCache) {
            configToUse = {
                ...configToUse,
                metadataCache: {
                    enabled: true,
                    adapter: HmrMetadataCacheAdapter,
                    options: { data: globalThis.__ormMetadataCache },
                },
            };
        }

        const myPromise = MikroORM.init({
            ...configToUse,
            ...injectConfig,
            // TODO env var, prevent on prod
            // debug: true,
        });

        // Capture metadata on first successful boot.
        // Strip live class/prototype refs so they don't overwrite fresh ones
        // after HMR re-evaluates entity modules (same as MikroORM's own cache
        // stripping in MetadataDiscovery before writing to disk).
        if (process.env.NODE_ENV === 'development' && !globalThis.__ormMetadataCache) {
            myPromise
                .then((orm) => {
                    if (!globalThis.__ormMetadataCache) {
                        const live = orm.getMetadata().getAll();
                        const cleaned: Record<string, any> = {};
                        for (const [key, meta] of Object.entries(live)) {
                            const {
                                class: _cls,
                                prototype: _proto,
                                props: _props,
                                referencingProperties: _refs,
                                propertyOrder: _po,
                                relations: _rels,
                                concurrencyCheckKeys: _cck,
                                checks: _chk,
                                ...rest
                            } = meta;
                            cleaned[key] = rest;
                        }
                        globalThis.__ormMetadataCache = cleaned;
                    }
                })
                .catch(console.error);
        }

        globalThis.__ormPromise = myPromise;

        if (process.env.NODE_ENV === 'development') {
            if (!globalThis.ormCleanups) globalThis.ormCleanups = [];
            // prettier really hates this part
            globalThis.ormCleanups.push(() => {
                const promiseToClose = globalThis.__ormPromise;
                globalThis.__ormPromise = null; // Nullify immediately so new requests get fresh ORM
                promiseToClose
                    ?.then((orm) => {
                        setTimeout(() => {
                            orm.close()
                                .catch(console.error)
                                .finally(() =>
                                    setTimeout(() => {
                                        orm.close(true).catch(console.error);
                                    }, 5000),
                                );
                        }, 10000);
                    })
                    .catch(console.error);
            });
        }
    }
    if (raw) {
        return globalThis.__ormPromise;
    } else {
        return { em: await getRequestFork() };
    }
}

export async function closeOrm(force?: boolean): Promise<void> {
    const oldOrm = globalThis.__ormPromise;
    globalThis.__ormPromise = null;
    if (oldOrm) await (await oldOrm).close(force);
}
