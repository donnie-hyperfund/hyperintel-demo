#!/usr/bin/env node
/**
 * Tests the extract-tester WASM module from JS.
 *
 * Build:  cd tester && wasm-pack build --target nodejs
 * Run:    node test.mjs
 * File:   node test.mjs path/to/file.docx
 */
import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const dir = fileURLToPath(new URL(".", import.meta.url));
const pkgPath = resolve(dir, "pkg/extract_tester.js");

if (!existsSync(pkgPath)) {
  console.error("WASM package not found. Build first:\n  cd tester && wasm-pack build --target nodejs");
  process.exit(1);
}

// wasm-pack --target nodejs emits CJS, use require to load it
const require = createRequire(import.meta.url);
const { extract_docx, extract_pptx, extract_pdf } = require(pkgPath);

const extractors = { docx: extract_docx, pptx: extract_pptx, pdf: extract_pdf };

// ── ad-hoc file mode ─────────────────────────────────────────────────────────

const fileArg = process.argv[2];
if (fileArg) {
  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const ext = extname(filePath).slice(1).toLowerCase();
  const fn = extractors[ext];
  if (!fn) {
    console.error(`Unsupported extension: .${ext} (supported: docx, pptx, pdf)`);
    process.exit(1);
  }
  const bytes = readFileSync(filePath);
  try {
    console.log(fn(bytes));
  } catch (e) {
    console.error("Extraction failed:", e.message);
    process.exit(1);
  }
  process.exit(0);
}

// ── automated tests ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS]  ${name}`);
    passed++;
  } catch (e) {
    console.log(`[FAIL]  ${name} — ${e.message}`);
    failed++;
  }
}

test("extract_docx is a function", () => {
  if (typeof extract_docx !== "function") throw new Error("not a function");
});

test("extract_pptx is a function", () => {
  if (typeof extract_pptx !== "function") throw new Error("not a function");
});

test("extract_pdf is a function", () => {
  if (typeof extract_pdf !== "function") throw new Error("not a function");
});

test("extract_docx rejects garbage bytes", () => {
  try {
    extract_docx(new Uint8Array([0, 1, 2, 3]));
    throw new Error("should have thrown");
  } catch (e) {
    if (e.message === "should have thrown") throw e;
  }
});

test("extract_pptx rejects garbage bytes", () => {
  try {
    extract_pptx(new Uint8Array([0, 1, 2, 3]));
    throw new Error("should have thrown");
  } catch (e) {
    if (e.message === "should have thrown") throw e;
  }
});

test("extract_pdf rejects garbage bytes", () => {
  try {
    extract_pdf(new Uint8Array([0, 1, 2, 3]));
    throw new Error("should have thrown");
  } catch (e) {
    if (e.message === "should have thrown") throw e;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
