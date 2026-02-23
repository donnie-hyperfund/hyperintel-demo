import { ensureTrailingSlash, stripTrailingSlash } from '@common/common/string.helpers';
import { frontendEnv } from '@/lib/env';

export const getWorkerUrl = (name: string, path = '', protocol = 'https') => {
    const alias = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_ALIAS;
    const workerEnv = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV;
    const base = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE;

    const subdomain = [alias, name, workerEnv].filter(Boolean).join('-');

    return ensureTrailingSlash(stripTrailingSlash(`${protocol}://${subdomain}.${base}`) + path);
};

/** Convert a plain object to FormData. Skips null/undefined values.
 *  TODO: nested? not viable..
 */
export function toFormData(data: Record<string, string | Blob | null | undefined>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(data)) {
        if (value != null) fd.append(key, value);
    }
    return fd;
}
