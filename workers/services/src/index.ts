import { createClerkClient } from '@clerk/backend';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { SubscribeInfoResponse } from '@/lib/schema/subscribe-info';
import { branchDoName, getPreviewAlias, PREVIEW_ALIAS_HEADER } from '@/workers/_common/util/preview-alias';
import {
    exportArtifactVersionDocx,
    type ExportArtifactVersionDocxInput,
    type ExportArtifactVersionDocxResult,
} from './docx-exporter';
import { getTopicSubscribeInfo } from './chat/chat-policy';
import { clearActiveStream, deadManCleanup } from './chat/stream-cleanup';
import {
    getLangfusePromptRawRpc,
    type GetLangfusePromptRawInput,
    type GetLangfusePromptRawResult,
} from './langfuse-service';

const app = new Hono<{ Bindings: ServicesEnv }>();

export class DocxExportService extends WorkerEntrypoint<ServicesEnv> {
    exportArtifactVersionDocx(input: ExportArtifactVersionDocxInput): Promise<ExportArtifactVersionDocxResult> {
        return exportArtifactVersionDocx(input, this.env);
    }
}

export class LangfusePromptService extends WorkerEntrypoint<ServicesEnv> {
    getPromptRaw(input: GetLangfusePromptRawInput): Promise<GetLangfusePromptRawResult> {
        return getLangfusePromptRawRpc(input, this.env);
    }
}

app.get('/', (c) => {
    return c.json({ status: 'ok', worker: 'services' });
});

app.get('/health', (c) => {
    return c.json({ status: 'healthy' });
});

// Internal RPC surface lives on WorkerEntrypoint classes (e.g. ChatServices below).
// HTTP /internal/* is intentionally not exposed — service bindings target the
// named entrypoint directly. This 404 is a guardrail against re-introducing
// HTTP-style internal routes by accident. Do not remove without removing the
// entrypoint class too.
app.all('/internal/*', (c) => c.notFound());

// WebSocket upgrade — authenticates via Clerk, then forwards to UserGateway DO
app.get('/ws', async (c) => {
    const upgrade = c.req.header('Upgrade');
    if (!upgrade || upgrade !== 'websocket') {
        return c.text('Expected WebSocket upgrade', 426);
    }

    const secretKey = await c.env.CLERK_SECRET_KEY.get();
    const publishableKey = c.env.CLERK_PUBLISHABLE_KEY;
    const clerk = createClerkClient({ secretKey, publishableKey });

    // Browsers can't set Authorization on WebSocket handshakes — token arrives via Sec-WebSocket-Protocol
    let reqToAuth = c.req.raw;
    const protocols = c.req.header('Sec-WebSocket-Protocol');
    if (protocols) {
        const match = protocols.match(/access_token-([^, ]+)/);
        if (match) {
            reqToAuth = new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) });
            reqToAuth.headers.set('Authorization', `Bearer ${match[1]}`);
        }
    }

    const state = await clerk.authenticateRequest(reqToAuth, { secretKey, publishableKey });
    const auth = state.toAuth();
    if (!auth?.userId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const alias = getPreviewAlias(c.env as any, c.req.raw);
    const id = c.env.USER_GATEWAY.idFromName(branchDoName(auth.userId, alias));
    const stub = c.env.USER_GATEWAY.get(id);

    // Forward preview alias header so UG can apply it for DB resolution
    let fwdRequest = c.req.raw;
    if (alias) {
        fwdRequest = new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) });
        fwdRequest.headers.set(PREVIEW_ALIAS_HEADER, alias);
    }
    return stub.fetch(fwdRequest);
});

export default app;

export class ChatServices extends WorkerEntrypoint<ServicesEnv> {
    async getTopicSubscribeInfo(req: unknown): Promise<SubscribeInfoResponse> {
        return getTopicSubscribeInfo(this.env, req);
    }

    async clearActiveStream(req: unknown): Promise<void> {
        return clearActiveStream(this.env, req);
    }

    async deadManCleanup(req: unknown): Promise<void> {
        return deadManCleanup(this.env, req);
    }
}
