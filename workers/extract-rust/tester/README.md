# Extract Tester (WASM)

Rust-to-WASM document extraction: converts PDF, DOCX, and PPTX files to Markdown.

## Prerequisites (one-time)

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

## Build

```bash
cd workers/extract-rust/tester
wasm-pack build --target nodejs
```

Re-run after any Rust source change.

## Run

```bash
# Extract a specific file
node test.mjs sample.pdf
node test.mjs sample.pptx
node test.mjs sample.docx

# Run automated smoke tests
node test.mjs
```
