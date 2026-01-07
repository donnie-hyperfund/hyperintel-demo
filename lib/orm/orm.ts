import { MikroORM, Options, EntityManager } from '@mikro-orm/postgresql';
import config from '@/mikro-orm.config';
import staticConfig from '@/mikro-orm.static.config';
import _ from 'underscore';
import { cache } from 'react';

// Fix to not leak connections on local dev server
declare global {
    // eslint-disable-next-line no-var,@typescript-eslint/no-explicit-any
    var ormCleanups: any[] | undefined;
}
if (process.env.NODE_ENV === 'development') {
    if (globalThis.ormCleanups?.length) {
        globalThis.ormCleanups.forEach((ormCleanup) => ormCleanup());
        globalThis.ormCleanups = [];
    }
}

let ormPromise: Promise<MikroORM> | null = null;
const reqStore = cache(() => ({ verified: false }));

export function rawOrmGuard(verify: string) {
    if (verify !== "I know what I'm doing")
        throw new Error("You don't know what you're doing");
    reqStore().verified = true;
}

// raw does not auto-fork
export async function getOrm(): Promise<{ em: EntityManager }>;
export async function getOrm(raw: true): Promise<MikroORM>;
export async function getOrm(
    injectConfig?: Options,
): Promise<{ em: EntityManager }>;
export async function getOrm(
    injectConfig: Options,
    raw: true,
): Promise<MikroORM>;
export async function getOrm(
    injectConfigOrRaw: Options | boolean = false,
    raw: boolean = false,
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
    if (!ormPromise) {
        const useStatic = process.env.VERCEL_ENV === 'production';
        const myPromise = MikroORM.init({
            ...(useStatic ? staticConfig : config),
            ...injectConfig,
            // TODO env var, prevent on prod
            // debug: true,
        });
        ormPromise = myPromise;

        if (process.env.NODE_ENV === 'development') {
            if (!globalThis.ormCleanups) globalThis.ormCleanups = [];
            // prettier really hates this part
            globalThis.ormCleanups.push(() => {
                myPromise
                    .then((orm) => {
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
        return ormPromise;
    } else {
        const orm = await ormPromise;
        return { em: orm.em.fork() };
    }
}

export async function closeOrm(force?: boolean): Promise<void> {
    const oldOrm = ormPromise;
    ormPromise = null;
    if (oldOrm) await (await oldOrm).close(force);
}
