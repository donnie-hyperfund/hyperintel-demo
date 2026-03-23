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

// ── v2 extractors (docx-parser / pptx-to-md with embedded images) ───────────

#[wasm_bindgen]
pub fn extract_docx_v2(bytes: &[u8]) -> Result<String, JsError> {
    let doc = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        docx_parser::MarkdownDocument::from_bytes(bytes)
    }))
    .map_err(|_| JsError::new("docx-parser: failed to parse document"))?;

    let mut md = doc.to_markdown(false);

    for (path, data) in &doc.images {
        let mime = mime_from_path(path);
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data);
        let data_uri = format!("data:{};base64,{}", mime, b64);
        md = md.replace(&format!("./{}", path), &data_uri);
        md = md.replace(path, &data_uri);
    }

    Ok(md)
}

#[wasm_bindgen]
pub fn extract_pptx_v2(bytes: &[u8]) -> Result<String, JsError> {
    let config = pptx_to_md::ParserConfig::builder()
        .extract_images(true)
        .compress_images(false)
        .image_handling_mode(pptx_to_md::ImageHandlingMode::InMarkdown)
        .include_slide_comment(true)
        .build();

    let mut container = pptx_to_md::PptxContainer::from_bytes(bytes.to_vec(), config)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let slides = container
        .parse_all()
        .map_err(|e| JsError::new(&e.to_string()))?;

    let mut md = String::new();
    for slide in &slides {
        if let Some(slide_md) = slide.convert_to_md() {
            md.push_str(&slide_md);
            md.push('\n');
        }
    }

    Ok(md)
}

fn mime_from_path(path: &str) -> &'static str {
    match path.rsplit('.').next().map(|e| e.to_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("tiff" | "tif") => "image/tiff",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Detect text in an image using default thresholds.
#[wasm_bindgen]
pub fn has_text_in_image(img_bytes: &[u8]) -> Result<bool, JsError> {
    has_text_in_image_with(img_bytes, 0.3, 15)
}

/// Detect text in an image with custom thresholds.
/// score_threshold: minimum combined score (0.0–1.0)
/// min_chars: minimum character-like components
#[wasm_bindgen]
pub fn has_text_in_image_with(
    img_bytes: &[u8],
    score_threshold: f32,
    min_chars: usize,
) -> Result<bool, JsError> {
    use image::Luma;
    use std::collections::HashMap;

    let img = image::load_from_memory(img_bytes)
        .map_err(|e| JsError::new(&e.to_string()))?
        .to_luma8();

    let (w, h) = img.dimensions();
    let total_pixels = (w * h) as f32;
    if total_pixels < 100.0 {
        return Ok(false);
    }

    let edges = imageproc::edges::canny(&img, 30.0, 80.0);
    let edge_count = edges.pixels().filter(|p| p[0] > 0).count() as f32;
    let edge_density = edge_count / total_pixels;

    let thresh = imageproc::contrast::otsu_level(&img);
    let binary = imageproc::contrast::threshold(&img, thresh);
    let labeled = imageproc::region_labelling::connected_components(
        &binary,
        imageproc::region_labelling::Connectivity::Eight,
        Luma([0u8]),
    );

    let mut component_sizes: HashMap<u32, u32> = HashMap::new();
    for p in labeled.pixels() {
        let label = p[0];
        if label > 0 {
            *component_sizes.entry(label).or_insert(0) += 1;
        }
    }

    let char_like_count = component_sizes
        .values()
        .filter(|&&size| size >= 10 && size <= 2000)
        .count();

    let component_density = char_like_count as f32 / (total_pixels / 1000.0);

    let row_densities: Vec<f32> = (0..h)
        .map(|y| {
            let dark = (0..w).filter(|&x| img.get_pixel(x, y)[0] < thresh).count() as f32;
            dark / w as f32
        })
        .collect();
    let mean = row_densities.iter().sum::<f32>() / h as f32;
    let variance = row_densities.iter().map(|&d| (d - mean).powi(2)).sum::<f32>() / h as f32;

    let edge_score = (edge_density / 0.12).min(1.0);
    let comp_score = (component_density / 5.0).min(1.0);
    let variance_score = (variance / 0.03).min(1.0);
    let score = 0.4 * edge_score + 0.35 * comp_score + 0.25 * variance_score;

    Ok(score > score_threshold && char_like_count > min_chars)
}
