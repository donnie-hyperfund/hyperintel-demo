use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn extract_docx(bytes: &[u8]) -> Result<String, JsError> {
    markdownify::docx::parse_docx(bytes).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn extract_pptx(bytes: &[u8]) -> Result<String, JsError> {
    markdownify::pptx::parse_pptx(bytes).map_err(|e| JsError::new(&e.to_string()))
}
