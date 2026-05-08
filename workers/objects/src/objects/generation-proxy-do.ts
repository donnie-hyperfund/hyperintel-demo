import { DurableObject } from 'cloudflare:workers';
import { createProxyError } from '@/lib/api/proxy-error';

/**
 * GenerationProxyDO — lightweight broker that holds a long-running fetch
 * to the chat worker's SSE stream endpoint, keeping the Worker alive
 * indefinitely (bypassing the 30s waitUntil limit).
 *
 * No business logic, no AI keys, no DB access. Just a fetch proxy with
 * alarm-based keep-alive to prevent DO eviction.
 */

const KEEPALIVE_INTERVAL_MS = 10_000; // 10s alarm heartbeat

export class GenerationProxyDO extends DurableObject<ObjectsEnv> {
    /**
     * Start a proxied generation.
     *
     * 1. Fetches the stream URL with the forwarded auth header
     * 2. Reads the first SSE event (contains IDs)
     * 3. Returns the IDs to the RPC caller
     * 4. Continues consuming the stream in the background (keeps the generation Worker alive)
     */
    async run(url: string, body: string, authHeader: string): Promise<unknown> {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authHeader && { Authorization: authHeader }),
            },
            body,
        });

        if (!response.ok || !response.body) {
            const text = await response.text().catch(() => '');
            return createProxyError(response.status, text, response.headers.get('content-type') ?? 'application/json');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Read until first complete SSE event (contains IDs)
        while (true) {
            const { done, value } = await reader.read();
            if (done) throw new Error('Stream ended before first event');
            buffer += decoder.decode(value, { stream: true });

            // SSE events are terminated by \n\n
            const eventEnd = buffer.indexOf('\n\n');
            if (eventEnd !== -1) {
                const raw = buffer.slice(0, eventEnd);
                const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
                if (!dataLine) throw new Error('First SSE event has no data line');
                const ids = JSON.parse(dataLine.slice(6)); // strip "data: "

                // Start background consumption + keep-alive alarms
                await this.ctx.storage.put('__stream_active', true);
                await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_INTERVAL_MS);
                void this.consumeStream(reader);

                return ids;
            }
        }
    }

    /** Drain the SSE stream silently — keeps the fetch (and the generation Worker) alive. */
    private async consumeStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
        try {
            while (true) {
                const { done } = await reader.read();
                if (done) break;
            }
        } catch (err) {
            console.error('[GenerationProxyDO] stream consumption error:', err);
        } finally {
            await this.ctx.storage.delete('__stream_active');
            await this.ctx.storage.deleteAlarm();
        }
    }

    /** Periodic keep-alive alarm — prevents DO eviction while stream is in-flight. */
    async alarm() {
        const active = await this.ctx.storage.get('__stream_active');
        if (active) {
            await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_INTERVAL_MS);
        }
    }
}
