use wasm_bindgen::prelude::*;

use extract_core::{ExtractOptions, text_detect::TextThreshold};

fn to_json(result: &extract_core::ExtractResult) -> String {
    let escaped = result
        .content
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!(
        r#"{{"content":"{}","imageText":{}}}"#,
        escaped, result.image_text
    )
}

// ── v1: markdownify ──────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn extract_docx(bytes: &[u8]) -> Result<String, JsError> {
    let r = extract_core::extract_docx(bytes, &ExtractOptions::default())
        .map_err(|e| JsError::new(&e))?;
    Ok(to_json(&r))
}

#[wasm_bindgen]
pub fn extract_pptx(bytes: &[u8]) -> Result<String, JsError> {
    let r = extract_core::extract_pptx(bytes, &ExtractOptions::default())
        .map_err(|e| JsError::new(&e))?;
    Ok(to_json(&r))
}

#[wasm_bindgen]
pub fn extract_pdf(bytes: &[u8]) -> Result<String, JsError> {
    let r = extract_core::extract_pdf(bytes, &ExtractOptions::default())
        .map_err(|e| JsError::new(&e))?;
    Ok(to_json(&r))
}

// ── v2: docx-parser / pptx-to-md ────────────────────────────────────────────

#[wasm_bindgen]
pub fn extract_docx_v2(bytes: &[u8]) -> Result<String, JsError> {
    let r = extract_core::extract_docx_v2(bytes, &ExtractOptions::default())
        .map_err(|e| JsError::new(&e))?;
    Ok(to_json(&r))
}

#[wasm_bindgen]
pub fn extract_pptx_v2(bytes: &[u8]) -> Result<String, JsError> {
    let r = extract_core::extract_pptx_v2(bytes, &ExtractOptions::default())
        .map_err(|e| JsError::new(&e))?;
    Ok(to_json(&r))
}

// ── with embed_images ────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn extract_docx_v2_embed(bytes: &[u8]) -> Result<String, JsError> {
    let opts = ExtractOptions { embed_images: true, ..Default::default() };
    let r = extract_core::extract_docx_v2(bytes, &opts)
        .map_err(|e| JsError::new(&e))?;
    Ok(to_json(&r))
}

#[wasm_bindgen]
pub fn extract_pptx_v2_embed(bytes: &[u8]) -> Result<String, JsError> {
    let opts = ExtractOptions { embed_images: true, ..Default::default() };
    let r = extract_core::extract_pptx_v2(bytes, &opts)
        .map_err(|e| JsError::new(&e))?;
    Ok(to_json(&r))
}

// ── debug ────────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn debug_pdf(bytes: &[u8]) -> Result<String, JsError> {
    let parser =
        unpdf::PdfParser::from_bytes(bytes).map_err(|e| JsError::new(&e.to_string()))?;
    parser
        .debug_page(1)
        .map_err(|e| JsError::new(&e.to_string()))
}

// ── image text detection (standalone) ────────────────────────────────────────

#[wasm_bindgen]
pub fn has_text_in_image(img_bytes: &[u8]) -> Result<bool, JsError> {
    Ok(extract_core::text_detect::has_significant_text(img_bytes))
}

#[wasm_bindgen]
pub fn has_text_in_image_with(
    img_bytes: &[u8],
    score_threshold: f32,
    min_chars: usize,
) -> Result<bool, JsError> {
    let threshold = TextThreshold {
        score: score_threshold,
        min_chars,
    };
    Ok(extract_core::text_detect::has_significant_text_with(
        img_bytes, &threshold,
    ))
}
