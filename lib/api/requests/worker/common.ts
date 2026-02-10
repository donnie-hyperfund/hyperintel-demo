import { ensureTrailingSlash, stripTrailingSlash } from '@common/common/string.helpers';
import { frontendEnv } from '@/lib/env';

export const getWorkerUrl = (name: string, path = '', protocol = 'https') =>
    ensureTrailingSlash(
        `${stripTrailingSlash(`${protocol}://${name}${frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV ? `-${frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV}` : ''}.${frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE}`)}${path}`,
    );

/** Convert a plain object to FormData. Skips undefined values.
 *  TODO: nested? not viable..
 */
export function toFormData(data: Record<string, string | Blob | undefined>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) fd.append(key, value);
    }
    return fd;
}
