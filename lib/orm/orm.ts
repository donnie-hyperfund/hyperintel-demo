import { EntityManager, MikroORM, Options } from '@mikro-orm/postgresql';
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
}

// Fix to not leak connections on local dev server
if (process.env.NODE_ENV === 'development') {
    if (globalThis.ormCleanups?.length) {
        globalThis.ormCleanups.forEach((ormCleanup) => ormCleanup());
        globalThis.ormCleanups = [];
    }
}

const reqStore = cache(() => ({ verified: false }));

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
        const configToUse = useStatic ? staticConfig : config;
        const myPromise = MikroORM.init({
            ...configToUse,
            ...injectConfig,
            // TODO env var, prevent on prod
            // debug: true,
        });
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
        const orm = await globalThis.__ormPromise;
        return { em: orm.em.fork() };
    }
}

export async function closeOrm(force?: boolean): Promise<void> {
    const oldOrm = globalThis.__ormPromise;
    globalThis.__ormPromise = null;
    if (oldOrm) await (await oldOrm).close(force);
}
