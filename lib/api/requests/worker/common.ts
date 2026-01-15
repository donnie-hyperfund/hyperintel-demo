import { frontendEnv } from '@/lib/env';
import { ensureTrailingSlash, stripTrailingSlash } from '@common/common/string.helpers';

export const getWorkerUrl = (name: string, path = '', protocol = 'https') =>
    ensureTrailingSlash(
        `${stripTrailingSlash(`${protocol}://${name}${frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV ? `-${frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV}` : ''}.${frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE}`)}${path}`,
    );
