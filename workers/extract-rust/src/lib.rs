use worker::*;

use extract_core::ExtractOptions;
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

fn extract_response(result: extract_core::ExtractResult) -> Result<HttpResponse> {
    let resp = ExtractResponse {
        content: result.content,
        image_text: result.image_text,
    };
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

            let opts = parse_options(&req);
            let body = collect_body(req).await?;

            let result = match filetype.as_str() {
                "docx" => extract_core::extract_docx(&body, &opts),
                "pptx" => extract_core::extract_pptx(&body, &opts),
                "pdf" => extract_core::extract_pdf(&body, &opts),
                _ => {
                    return json_response(
                        400,
                        r#"{"error":"Missing or invalid X-File-Type header. Expected: docx | pptx | pdf"}"#,
                    )
                }
            };

            match result {
                Ok(r) => extract_response(r),
                Err(e) => json_response(500, &format!(r#"{{"error":"{}"}}"#, e)),
            }
        }

        (http::Method::POST, "/extract/v2") => {
            let filetype = req
                .headers()
                .get("x-file-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();

            let opts = parse_options(&req);
            let body = collect_body(req).await?;

            let result = match filetype.as_str() {
                "docx" => extract_core::extract_docx_v2(&body, &opts),
                "pptx" => extract_core::extract_pptx_v2(&body, &opts),
                "pdf" => extract_core::extract_pdf(&body, &opts),
                _ => {
                    return json_response(
                        400,
                        r#"{"error":"Missing or invalid X-File-Type header. Expected: docx | pptx | pdf"}"#,
                    )
                }
            };

            match result {
                Ok(r) => extract_response(r),
                Err(e) => json_response(500, &format!(r#"{{"error":"{}"}}"#, e)),
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

/// Parse options from headers, falling back to defaults.
/// X-Text-Score: f32 (0.0–1.0), X-Text-Min-Chars: usize, X-Embed-Images: "true"/"false"
fn parse_options(req: &HttpRequest) -> ExtractOptions {
    let mut opts = ExtractOptions::default();
    if let Some(v) = req.headers().get("x-text-score").and_then(|v| v.to_str().ok()) {
        if let Ok(s) = v.parse::<f32>() {
            opts.threshold.score = s;
        }
    }
    if let Some(v) = req.headers().get("x-text-min-chars").and_then(|v| v.to_str().ok()) {
        if let Ok(c) = v.parse::<usize>() {
            opts.threshold.min_chars = c;
        }
    }
    if let Some(v) = req.headers().get("x-embed-images").and_then(|v| v.to_str().ok()) {
        opts.embed_images = v == "true" || v == "1";
    }
    opts
}
