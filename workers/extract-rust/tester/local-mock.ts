/**
 * Local mock Fetcher for the Rust WASM extractor.
 *
 * Mirrors the routing in src/lib.rs — /extract/v2 with X-File-Type and
 * X-Embed-Images headers. Calls the tester WASM package directly.
 *
 * WASM loaded on-demand. If not built, throws a clear error on first use:
 *   cd workers/extract-rust/tester && wasm-pack build --target nodejs
 */

interface WasmModule {
    extract_docx_v2: (bytes: Uint8Array) => string;
    extract_docx_v2_embed: (bytes: Uint8Array) => string;
    extract_pptx_v2: (bytes: Uint8Array) => string;
    extract_pptx_v2_embed: (bytes: Uint8Array) => string;
    extract_pdf: (bytes: Uint8Array) => string;
    has_text_in_image: (bytes: Uint8Array) => boolean;
}

type ExtractFn = (bytes: Uint8Array) => string;

let _wasm: WasmModule | null = null;

function loadWasm(): WasmModule {
    if (_wasm) return _wasm;
    try {
        // eslint-disable-next-line -- require() for wasm-pack CJS output
        _wasm = require('./pkg/extract_tester.js') as WasmModule;
        return _wasm;
    } catch {
        throw new Error(
            '[MockRustWorkerFetcher] WASM not compiled. Build it:\n' +
            '  cd workers/extract-rust/tester && wasm-pack build --target nodejs',
        );
    }
}

function getHandlers(wasm: WasmModule): Record<string, { normal: ExtractFn; embed: ExtractFn }> {
    return {
        docx: { normal: wasm.extract_docx_v2, embed: wasm.extract_docx_v2_embed },
        pptx: { normal: wasm.extract_pptx_v2, embed: wasm.extract_pptx_v2_embed },
        pdf: { normal: wasm.extract_pdf, embed: wasm.extract_pdf },
    };
}

export class MockRustWorkerFetcher {
    async fetch(input: string | Request, init?: RequestInit): Promise<Response> {
        const req = typeof input === 'string' ? new Request(input, init) : input;
        const url = new URL(req.url);
        const path = url.pathname;

        // GET / or /health — mirrors lib.rs lines 38-40
        if (req.method === 'GET' && (path === '/' || path === '/health')) {
            return Response.json({ status: 'ok', worker: 'extract-rust-mock' });
        }

        // POST /extract or /extract/v2 — mirrors lib.rs lines 42-98
        if (req.method === 'POST' && (path === '/extract/v2' || path === '/extract')) {
            const filetype = req.headers.get('x-file-type') ?? '';
            const embedImages = req.headers.get('x-embed-images') === 'true';

            const handler = getHandlers(loadWasm())[filetype];
            if (!handler) {
                return Response.json(
                    { error: 'Missing or invalid X-File-Type header. Expected: docx | pptx | pdf' },
                    { status: 400 },
                );
            }

            try {
                const body = await req.arrayBuffer();
                const fn = embedImages ? handler.embed : handler.normal;
                const resultJson = fn(new Uint8Array(body));
                return new Response(resultJson, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (e: any) {
                return Response.json({ error: e.message ?? 'Extraction failed' }, { status: 500 });
            }
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    }
}
