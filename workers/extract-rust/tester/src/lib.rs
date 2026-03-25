use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn extract_docx(bytes: &[u8]) -> Result<String, JsError> {
    markdownify::docx::parse_docx(bytes).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn extract_pptx(bytes: &[u8]) -> Result<String, JsError> {
    markdownify::pptx::parse_pptx(bytes).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn extract_pdf(bytes: &[u8]) -> Result<String, JsError> {
    let doc = unpdf::parse_bytes(bytes).map_err(|e| JsError::new(&e.to_string()))?;
    let options = unpdf::render::RenderOptions {
        cleanup: Some(unpdf::render::CleanupOptions {
            max_consecutive_newlines: 2,
            ..unpdf::render::CleanupOptions::standard()
        }),
        ..unpdf::render::RenderOptions::default()
    };
    unpdf::render::to_markdown(&doc, &options).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn debug_pdf(bytes: &[u8]) -> Result<String, JsError> {
    let parser = unpdf::PdfParser::from_bytes(bytes).map_err(|e| JsError::new(&e.to_string()))?;
    parser.debug_page(1).map_err(|e| JsError::new(&e.to_string()))
}
