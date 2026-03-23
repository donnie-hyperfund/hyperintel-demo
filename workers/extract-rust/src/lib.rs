use worker::*;

mod images;
mod text_detect;

use serde::Serialize;

#[derive(Serialize)]
struct ExtractResponse {
    content: String,
    #[serde(rename = "imageText")]
    image_text: bool,
}

fn json_response(status: u16, body: &str) -> Result<HttpResponse> {
    let bytes = body.as_bytes().to_vec();
    let stream = futures_util::stream::once(async move { Ok::<_, worker::Error>(bytes) });
    Ok(http::Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from_stream(stream)?)?)
}

fn extract_response(content: String, image_text: bool) -> Result<HttpResponse> {
    let resp = ExtractResponse { content, image_text };
    let body = serde_json::to_string(&resp)
        .unwrap_or_else(|_| r#"{"error":"Failed to serialize response"}"#.to_string());
    json_response(200, &body)
}

#[event(fetch)]
async fn fetch(req: HttpRequest, _env: Env, _ctx: Context) -> Result<HttpResponse> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    match (method, path.as_str()) {
        (http::Method::GET, "/" | "/health") => {
            json_response(200, r#"{"status":"ok","worker":"extract-rust"}"#)
        }

        (http::Method::POST, "/extract") => {
            let filetype = req
                .headers()
                .get("x-file-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();

            let threshold = parse_threshold(&req);
            let body = collect_body(req).await?;

            match filetype.as_str() {
                "docx" => extract_docx(&body, &threshold),
                "pptx" => extract_pptx(&body, &threshold),
                "pdf" => extract_pdf(&body, &threshold),
                _ => json_response(
                    400,
                    r#"{"error":"Missing or invalid X-File-Type header. Expected: docx | pptx | pdf"}"#,
                ),
            }
        }

        // v2 endpoints use docx-parser / pptx-to-md (with embedded images in markdown)
        (http::Method::POST, "/extract/v2") => {
            let filetype = req
                .headers()
                .get("x-file-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();

            let threshold = parse_threshold(&req);
            let body = collect_body(req).await?;

            match filetype.as_str() {
                "docx" => extract_docx_v2(&body, &threshold),
                "pptx" => extract_pptx_v2(&body, &threshold),
                "pdf" => extract_pdf(&body, &threshold), // PDF uses same extractor
                _ => json_response(
                    400,
                    r#"{"error":"Missing or invalid X-File-Type header. Expected: docx | pptx | pdf"}"#,
                ),
            }
        }

        _ => json_response(404, r#"{"error":"Not found"}"#),
    }
}

async fn collect_body(req: HttpRequest) -> Result<Vec<u8>> {
    use futures_util::StreamExt;
    let mut body = req.into_body();
    let mut bytes = Vec::new();
    while let Some(chunk) = body.next().await {
        let chunk = chunk?;
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Parse optional threshold from headers, falling back to defaults.
/// X-Text-Score: f32 (0.0–1.0), X-Text-Min-Chars: usize
fn parse_threshold(req: &HttpRequest) -> text_detect::TextThreshold {
    let mut t = text_detect::TextThreshold::default();
    if let Some(v) = req.headers().get("x-text-score").and_then(|v| v.to_str().ok()) {
        if let Ok(s) = v.parse::<f32>() {
            t.score = s;
        }
    }
    if let Some(v) = req.headers().get("x-text-min-chars").and_then(|v| v.to_str().ok()) {
        if let Ok(c) = v.parse::<usize>() {
            t.min_chars = c;
        }
    }
    t
}

fn any_image_has_text(images: &[Vec<u8>], threshold: &text_detect::TextThreshold) -> bool {
    images.iter().any(|img| text_detect::has_significant_text_with(img, threshold))
}

fn extract_docx(bytes: &[u8], threshold: &text_detect::TextThreshold) -> Result<HttpResponse> {
    match markdownify::docx::parse_docx(bytes) {
        Ok(md) => {
            let images = images::extract_docx_images(bytes);
            let image_text = any_image_has_text(&images, threshold);
            extract_response(md, image_text)
        }
        Err(e) => json_response(500, &format!(r#"{{"error":"{}"}}"#, e)),
    }
}

fn extract_pptx(bytes: &[u8], threshold: &text_detect::TextThreshold) -> Result<HttpResponse> {
    match markdownify::pptx::parse_pptx(bytes) {
        Ok(md) => {
            let images = images::extract_pptx_images(bytes);
            let image_text = any_image_has_text(&images, threshold);
            extract_response(md, image_text)
        }
        Err(e) => json_response(500, &format!(r#"{{"error":"{}"}}"#, e)),
    }
}

// ── Alternate extractors using docx-parser / pptx-to-md ─────────────────────

fn extract_docx_v2(bytes: &[u8], threshold: &text_detect::TextThreshold) -> Result<HttpResponse> {
    // docx-parser panics on errors, so catch them
    let doc = std::panic::catch_unwind(|| docx_parser::MarkdownDocument::from_bytes(bytes))
        .map_err(|_| worker::Error::RustError("docx-parser: failed to parse document".into()))?;

    let mut md = doc.to_markdown(false);

    // Embed images as base64 data URIs in the markdown
    // docx-parser outputs ![descr](./word/media/image1.png) — replace with inline base64
    for (path, data) in &doc.images {
        let mime = mime_from_path(path);
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data);
        let data_uri = format!("data:{};base64,{}", mime, b64);
        // Replace both ./path and path references
        md = md.replace(&format!("./{}", path), &data_uri);
        md = md.replace(path, &data_uri);
    }

    let image_bytes: Vec<Vec<u8>> = doc.images.values().cloned().collect();
    let image_text = any_image_has_text(&image_bytes, threshold);
    extract_response(md, image_text)
}

fn extract_pptx_v2(bytes: &[u8], threshold: &text_detect::TextThreshold) -> Result<HttpResponse> {
    let config = pptx_to_md::ParserConfig::builder()
        .extract_images(true)
        .compress_images(false)
        .image_handling_mode(pptx_to_md::ImageHandlingMode::InMarkdown)
        .include_slide_comment(true)
        .build();

    let mut container = pptx_to_md::PptxContainer::from_bytes(bytes.to_vec(), config)
        .map_err(|e| worker::Error::RustError(format!("pptx-to-md: {}", e)))?;

    let slides = container
        .parse_all()
        .map_err(|e| worker::Error::RustError(format!("pptx-to-md: {}", e)))?;

    let mut md = String::new();
    let mut all_image_bytes: Vec<Vec<u8>> = Vec::new();

    for slide in &slides {
        if let Some(slide_md) = slide.convert_to_md() {
            md.push_str(&slide_md);
            md.push('\n');
        }
        // Collect raw image data for text detection
        all_image_bytes.extend(slide.image_data.values().cloned());
    }

    let image_text = any_image_has_text(&all_image_bytes, threshold);
    extract_response(md, image_text)
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

fn extract_pdf(bytes: &[u8], threshold: &text_detect::TextThreshold) -> Result<HttpResponse> {
    let doc = match unpdf::parse_bytes(bytes) {
        Ok(d) => d,
        Err(e) => return json_response(500, &format!(r#"{{"error":"{}"}}"#, e)),
    };
    let options = unpdf::render::RenderOptions {
        cleanup: Some(unpdf::render::CleanupOptions {
            max_consecutive_newlines: 2,
            ..unpdf::render::CleanupOptions::standard()
        }),
        ..unpdf::render::RenderOptions::default()
    };
    match unpdf::render::to_markdown(&doc, &options) {
        Ok(md) => {
            let images: Vec<Vec<u8>> = doc
                .resources
                .values()
                .filter(|r| r.is_image())
                .map(|r| r.data.clone())
                .collect();
            let image_text = any_image_has_text(&images, threshold);
            extract_response(md, image_text)
        }
        Err(e) => json_response(500, &format!(r#"{{"error":"{}"}}"#, e)),
    }
}
