pub mod images;
pub mod text_detect;

use base64::Engine;

/// Options controlling extraction behavior.
#[derive(Clone)]
pub struct ExtractOptions {
    /// Text detection thresholds
    pub threshold: text_detect::TextThreshold,
    /// Whether to embed images as base64 data URIs in the markdown (default: false)
    pub embed_images: bool,
}

impl Default for ExtractOptions {
    fn default() -> Self {
        Self {
            threshold: text_detect::TextThreshold::default(),
            embed_images: false,
        }
    }
}

/// Result of document extraction.
pub struct ExtractResult {
    /// Extracted markdown content
    pub content: String,
    /// Whether any embedded image contains significant text
    pub image_text: bool,
}

/// Check if any image in the set contains significant text.
pub fn any_image_has_text(images: &[Vec<u8>], threshold: &text_detect::TextThreshold) -> bool {
    images
        .iter()
        .any(|img| text_detect::has_significant_text_with(img, threshold))
}

// ── v1: markdownify ──────────────────────────────────────────────────────────

pub fn extract_docx(bytes: &[u8], opts: &ExtractOptions) -> Result<ExtractResult, String> {
    let md = markdownify::docx::parse_docx(bytes).map_err(|e| e.to_string())?;
    let images = images::extract_docx_images(bytes);
    let image_text = any_image_has_text(&images, &opts.threshold);
    Ok(ExtractResult { content: md, image_text })
}

pub fn extract_pptx(bytes: &[u8], opts: &ExtractOptions) -> Result<ExtractResult, String> {
    let md = markdownify::pptx::parse_pptx(bytes).map_err(|e| e.to_string())?;
    let images = images::extract_pptx_images(bytes);
    let image_text = any_image_has_text(&images, &opts.threshold);
    Ok(ExtractResult { content: md, image_text })
}

pub fn extract_pdf(bytes: &[u8], opts: &ExtractOptions) -> Result<ExtractResult, String> {
    let doc = unpdf::parse_bytes(bytes).map_err(|e| e.to_string())?;
    let render_opts = unpdf::render::RenderOptions {
        cleanup: Some(unpdf::render::CleanupOptions {
            max_consecutive_newlines: 2,
            ..unpdf::render::CleanupOptions::standard()
        }),
        ..unpdf::render::RenderOptions::default()
    };
    let md = unpdf::render::to_markdown(&doc, &render_opts).map_err(|e| e.to_string())?;
    let images: Vec<Vec<u8>> = doc
        .resources
        .values()
        .filter(|r| r.is_image())
        .map(|r| r.data.clone())
        .collect();
    let image_text = any_image_has_text(&images, &opts.threshold);
    Ok(ExtractResult { content: md, image_text })
}

// ── v2: docx-parser / pptx-to-md (with embedded images) ─────────────────────

pub fn extract_docx_v2(bytes: &[u8], opts: &ExtractOptions) -> Result<ExtractResult, String> {
    let doc = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        docx_parser::MarkdownDocument::from_bytes(bytes)
    }))
    .map_err(|_| "docx-parser: failed to parse document".to_string())?;

    let mut md = doc.to_markdown(false);

    if opts.embed_images {
        for (path, data) in &doc.images {
            let mime = mime_from_path(path);
            let b64 = base64::engine::general_purpose::STANDARD.encode(data);
            let data_uri = format!("data:{};base64,{}", mime, b64);
            md = md.replace(&format!("./{}", path), &data_uri);
            md = md.replace(path, &data_uri);
        }
    }

    let image_bytes: Vec<Vec<u8>> = doc.images.values().cloned().collect();
    let image_text = any_image_has_text(&image_bytes, &opts.threshold);
    Ok(ExtractResult { content: md, image_text })
}

pub fn extract_pptx_v2(bytes: &[u8], opts: &ExtractOptions) -> Result<ExtractResult, String> {
    let config = pptx_to_md::ParserConfig::builder()
        .extract_images(true) // always extract for text detection
        .compress_images(false)
        .image_handling_mode(if opts.embed_images {
            pptx_to_md::ImageHandlingMode::InMarkdown
        } else {
            pptx_to_md::ImageHandlingMode::Manually
        })
        .include_slide_comment(true)
        .build();

    let mut container = pptx_to_md::PptxContainer::from_bytes(bytes.to_vec(), config)
        .map_err(|e| format!("pptx-to-md: {}", e))?;

    let slides = container
        .parse_all()
        .map_err(|e| format!("pptx-to-md: {}", e))?;

    let mut md = String::new();
    let mut all_image_bytes: Vec<Vec<u8>> = Vec::new();

    for slide in &slides {
        if let Some(slide_md) = slide.convert_to_md() {
            md.push_str(&slide_md);
            md.push('\n');
        }
        all_image_bytes.extend(slide.image_data.values().cloned());
    }

    let image_text = any_image_has_text(&all_image_bytes, &opts.threshold);
    Ok(ExtractResult { content: md, image_text })
}

// ── helpers ──────────────────────────────────────────────────────────────────

pub fn mime_from_path(path: &str) -> &'static str {
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
