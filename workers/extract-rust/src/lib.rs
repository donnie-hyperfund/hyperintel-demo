use worker::*;

fn json_response(status: u16, body: &str) -> Result<HttpResponse> {
    let bytes = body.as_bytes().to_vec();
    let stream = futures_util::stream::once(async move { Ok::<_, worker::Error>(bytes) });
    Ok(http::Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from_stream(stream)?)?)
}

fn text_response(status: u16, body: &str) -> Result<HttpResponse> {
    let bytes = body.as_bytes().to_vec();
    let stream = futures_util::stream::once(async move { Ok::<_, worker::Error>(bytes) });
    Ok(http::Response::builder()
        .status(status)
        .header("content-type", "text/markdown; charset=utf-8")
        .body(Body::from_stream(stream)?)?)
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

            let body = collect_body(req).await?;

            match filetype.as_str() {
                "docx" => extract_docx(&body),
                "pptx" => extract_pptx(&body),
                _ => json_response(
                    400,
                    r#"{"error":"Missing or invalid X-File-Type header. Expected: docx | pptx"}"#,
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

fn extract_docx(_bytes: &[u8]) -> Result<HttpResponse> {
    // TODO
    json_response(
        501,
        r#"{"error":"docx extraction not yet wired - vendor crate needs patching"}"#,
    )
}

fn extract_pptx(_bytes: &[u8]) -> Result<HttpResponse> {
    // TODO
    json_response(
        501,
        r#"{"error":"pptx extraction not yet wired - vendor crate needs patching"}"#,
    )
}
