interface Env {
    HI_CHAT: Fetcher;
    HI_SERVICES: Fetcher;
    HI_OBJECTS: Fetcher;
    HI_EXTRACTION: Fetcher;
    HI_EMBEDDING: Fetcher;
}

const WORKER_PREFIXES: Array<[prefix: string, binding: keyof Env]> = [
    ['/__workers/chat', 'HI_CHAT'],
    ['/__workers/services', 'HI_SERVICES'],
    ['/__workers/objects', 'HI_OBJECTS'],
    ['/__workers/extraction', 'HI_EXTRACTION'],
    ['/__workers/embedding', 'HI_EMBEDDING'],
];

export default {
    fetch(request: Request, env: Env): Promise<Response> | Response {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return Response.json({
                status: 'healthy',
                worker: 'local-gateway',
                routes: {
                    app: 'hi-chat',
                    websocket: 'hi-services:/ws',
                    debug: Object.fromEntries(WORKER_PREFIXES.map(([prefix, binding]) => [prefix, binding])),
                },
            });
        }

        for (const [prefix, binding] of WORKER_PREFIXES) {
            if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
                return env[binding].fetch(stripPrefix(request, prefix));
            }
        }

        if (url.pathname === '/ws' || url.pathname.startsWith('/services/')) {
            return env.HI_SERVICES.fetch(request);
        }

        return env.HI_CHAT.fetch(request);
    },
};

function stripPrefix(request: Request, prefix: string): Request {
    const url = new URL(request.url);
    url.pathname = url.pathname.slice(prefix.length) || '/';
    return new Request(url, request);
}
