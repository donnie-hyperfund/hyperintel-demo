#!/usr/bin/env node
/**
 * Local integration test for the extract-rust worker.
 * Builds WASM, starts wrangler dev, sends requests, checks responses.
 *
 * Usage: node test/test-worker.mjs
 * Optional: node test/test-worker.mjs --build-only   (just verify WASM compilation)
 *           node test/test-worker.mjs path/to/file.docx
 *           node test/test-worker.mjs path/to/file.pptx
 */
import { spawn, execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";
import { setTimeout } from "timers/promises";
import { fileURLToPath } from "url";

const WORKER_DIR = resolve(fileURLToPath(import.meta.url), "../..");
const PORT = 8787;
const BASE = `http://localhost:${PORT}`;

// ── helpers ──────────────────────────────────────────────────────────────────

function log(icon, msg) {
  console.log(`${icon}  ${msg}`);
}

async function waitForReady(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await setTimeout(1000);
  }
  return false;
}

// ── test cases ───────────────────────────────────────────────────────────────

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    log("[PASS]", name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    log("[FAIL]", `${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const buildOnly = args.includes("--build-only");

// If a file path is passed, just send it and print the response
const fileArg = args.find((a) => !a.startsWith("--"));

log(">>", `Building WASM in ${WORKER_DIR}...`);
try {
  execSync(
    'cargo install -q "worker-build@^0.7" && worker-build --release',
    { cwd: WORKER_DIR, stdio: "inherit" }
  );
  log("[OK]", "WASM build succeeded");
} catch {
  log("[XX]", "WASM build FAILED");
  process.exit(1);
}

if (buildOnly) {
  log("[OK]", "Build-only mode, done.");
  process.exit(0);
}

// Start wrangler dev
log(">>", "Starting wrangler dev...");
const wrangler = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
  cwd: WORKER_DIR,
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

let wranglerOutput = "";
wrangler.stdout.on("data", (d) => (wranglerOutput += d.toString()));
wrangler.stderr.on("data", (d) => (wranglerOutput += d.toString()));

const cleanup = () => {
  try {
    wrangler.kill("SIGTERM");
  } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

const ready = await waitForReady(`${BASE}/health`);
if (!ready) {
  log("[XX]", "wrangler dev did not become ready in time");
  console.log("--- wrangler output ---\n", wranglerOutput);
  cleanup();
  process.exit(1);
}
log("[OK]", "Worker is running");

// ── ad-hoc file test mode ────────────────────────────────────────────────────

if (fileArg) {
  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    log("[XX]", `File not found: ${filePath}`);
    cleanup();
    process.exit(1);
  }
  const ext = extname(filePath).slice(1).toLowerCase();
  if (!["docx", "pptx"].includes(ext)) {
    log("[XX]", `Unsupported extension: .${ext}`);
    cleanup();
    process.exit(1);
  }
  log(">>", `Sending ${filePath} as ${ext}...`);
  const body = readFileSync(filePath);
  const r = await fetch(`${BASE}/extract`, {
    method: "POST",
    headers: { "X-File-Type": ext },
    body,
  });
  console.log(`\nHTTP ${r.status}`);
  console.log(await r.text());
  cleanup();
  process.exit(r.ok ? 0 : 1);
}

// ── automated tests ──────────────────────────────────────────────────────────

await test("GET /health returns 200", async () => {
  const r = await fetch(`${BASE}/health`);
  assert(r.status === 200, `got ${r.status}`);
  const json = await r.json();
  assert(json.status === "ok", `status field: ${json.status}`);
});

await test("GET /nonexistent returns 404", async () => {
  const r = await fetch(`${BASE}/nonexistent`);
  assert(r.status === 404, `got ${r.status}`);
});

await test("POST /extract without X-File-Type returns 400", async () => {
  const r = await fetch(`${BASE}/extract`, {
    method: "POST",
    body: new Uint8Array([1, 2, 3]),
  });
  assert(r.status === 400, `got ${r.status}`);
});

await test("POST /extract with X-File-Type: docx reaches handler", async () => {
  const r = await fetch(`${BASE}/extract`, {
    method: "POST",
    headers: { "X-File-Type": "docx" },
    body: new Uint8Array([1, 2, 3]),
  });
  // 501 = stub not yet wired, 200 = extraction works, both prove routing works
  assert([200, 501].includes(r.status), `unexpected status: ${r.status}`);
});

await test("POST /extract with X-File-Type: pptx reaches handler", async () => {
  const r = await fetch(`${BASE}/extract`, {
    method: "POST",
    headers: { "X-File-Type": "pptx" },
    body: new Uint8Array([1, 2, 3]),
  });
  assert([200, 501].includes(r.status), `unexpected status: ${r.status}`);
});

// ── summary ──────────────────────────────────────────────────────────────────

cleanup();

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
