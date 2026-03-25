#!/usr/bin/env node
/**
 * Tests the extract-tester WASM module from JS.
 *
 * Build:  cd tester && wasm-pack build --target nodejs
 * Run:    node test.mjs
 * File:   node test.mjs path/to/file.docx
 * v2:     node test.mjs --v2 path/to/file.docx  (docx-parser / pptx-to-md with embedded images)
 * Reducto: node test.mjs --reducto path/to/file.pdf  (upload to Reducto, dump response)
 * Image:  node test.mjs path/to/image.png   (runs text detection)
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
const {
  extract_docx, extract_pptx, extract_pdf,
  extract_docx_v2, extract_pptx_v2,
  has_text_in_image, has_text_in_image_with,
} = require(pkgPath);

const extractors = { docx: extract_docx, pptx: extract_pptx, pdf: extract_pdf };
const extractorsV2 = { docx: extract_docx_v2, pptx: extract_pptx_v2, pdf: extract_pdf };
const imageExts = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);

// ── ad-hoc file mode ─────────────────────────────────────────────────────────

const useReducto = process.argv[2] === "--reducto";
const useV2 = process.argv[2] === "--v2";
const hasFlag = useReducto || useV2;
const fileArg = process.argv[hasFlag ? 3 : 2];
if (fileArg) {
  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const ext = extname(filePath).slice(1).toLowerCase();
  const bytes = readFileSync(filePath);

  // Image file → text detection
  if (imageExts.has(ext)) {
    try {
      const scoreArg = parseFloat(process.argv[3]);
      const charsArg = parseInt(process.argv[4], 10);
      const hasCustom = !isNaN(scoreArg) && !isNaN(charsArg);

      const result = hasCustom
        ? has_text_in_image_with(bytes, scoreArg, charsArg)
        : has_text_in_image(bytes);

      console.log(`has_text: ${result}`);
      if (hasCustom) console.log(`  (score_threshold=${scoreArg}, min_chars=${charsArg})`);
    } catch (e) {
      console.error("Text detection failed:", e.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // Reducto mode → upload & parse via Reducto API
  if (useReducto) {
    const docExts = new Set(["docx", "pptx", "pdf"]);
    if (!docExts.has(ext)) {
      console.error(`Reducto: unsupported extension .${ext} (supported: docx, pptx, pdf)`);
      process.exit(1);
    }
    try {
      const { config } = await import("dotenv");
      config({ path: resolve(dir, "../../../.env") });
    } catch {
      console.error("dotenv not available — install it or set REDUCTO_API_KEY manually");
      process.exit(1);
    }
    const apiKey = process.env.REDUCTO_API_KEY;
    if (!apiKey) {
      console.error("REDUCTO_API_KEY not found in .env");
      process.exit(1);
    }
    const { default: Reducto } = await import("reductoai");
    const { toFile } = await import("reductoai/uploads");
    const client = new Reducto({ apiKey });

    const mimeTypes = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      pdf: "application/pdf",
    };

    console.error(`[reducto] Uploading ${filePath}...`);
    const file = await toFile(new Blob([bytes], { type: mimeTypes[ext] }), fileArg);
    const upload = await client.upload({ file });
    console.error(`[reducto] Uploaded: ${upload.file_id}`);

    console.error(`[reducto] Parsing...`);
    const result = await client.parse.run({
      input: upload,
      formatting: { table_output_format: "md" },
      enhance: { summarize_figures: true },
    });

    console.error(`[reducto] Job: ${result.job_id}, pages: ${result.usage?.num_pages}`);

    if (result.result?.type === "full") {
      const md = result.result.chunks.map((c) => c.content).join("\n\n");
      console.log(md);
    } else if (result.result?.type === "url") {
      console.error(`[reducto] Large result, fetching from URL...`);
      const res = await fetch(result.result.url);
      const full = await res.json();
      const md = full.chunks.map((c) => c.content).join("\n\n");
      console.log(md);
    } else {
      console.error("[reducto] Unexpected response:");
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  }

  // Document file → extraction
  const fns = useV2 ? extractorsV2 : extractors;
  const fn = fns[ext];
  if (!fn) {
    console.error(`Unsupported extension: .${ext} (supported: docx, pptx, pdf, png, jpg, gif, bmp, webp)`);
    process.exit(1);
  }
  if (useV2) console.error(`[v2] Using docx-parser/pptx-to-md for .${ext}`);
  try {
    const raw = fn(bytes);
    try {
      const parsed = JSON.parse(raw);
      console.log(parsed.content);
      console.error(`\n[imageText: ${parsed.imageText}]`);
    } catch {
      // not JSON, just dump as-is
      console.log(raw);
    }
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
