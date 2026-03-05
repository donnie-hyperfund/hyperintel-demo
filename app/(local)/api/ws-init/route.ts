import { ensureDevWsServer } from '@/lib/local/cf-env-secret-mock';

export async function GET() {
    if (process.env.NODE_ENV !== 'production') {
        ensureDevWsServer();
    }
    return new Response('ok');
}
