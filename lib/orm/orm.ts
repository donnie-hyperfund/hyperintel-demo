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
 * Cache adapter that re-keys metadata by entity `path` (source file path)
 * so lookups by file path (which MikroORM uses internally) actually hit.
 *
 * `GeneratedCacheAdapter` expects file-path keys, but `getAll()` returns
 * `ClassName-hash` keys — causing every lookup to miss and breaking the
 * identity map (all rows collapse to one entity with PK=undefined).
 *
 * This adapter builds a path→metadata index on construction and handles
 * both key formats transparently.
 */
class HmrMetadataCacheAdapter implements CacheAdapter {
    private byPath = new Map<string, any>();
    private byName = new Map<string, any>();

    constructor(private options: { data: Record<string, any> }) {
        for (const [key, meta] of Object.entries(options.data)) {
            this.byName.set(key, meta);
            // Index by source file path (stripping extension) for MikroORM's internal lookups
            if (meta?.path) {
                const normalized = meta.path.replace(/\.[jt]s$/, '');
                this.byPath.set(normalized, meta);
            }
        }
    }

    get(name: string) {
        const key = name.replace(/\.[jt]s$/, '');
        return this.byPath.get(key) ?? this.byName.get(key) ?? undefined;
    }

    set(name: string, data: unknown, _origin: string) {
        const key = name.replace(/\.[jt]s$/, '');
        this.byPath.set(key, data);
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
                            const { class: _cls, prototype: _proto, props: _props,
                                referencingProperties: _refs, propertyOrder: _po,
                                relations: _rels, concurrencyCheckKeys: _cck,
                                checks: _chk, ...rest } = meta;
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
