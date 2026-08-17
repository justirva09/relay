use crate::models::{HttpRequestPayload, HttpResponsePayload};
use reqwest::multipart::{Form, Part};
use reqwest::Method;
use std::path::Path;
use std::str::FromStr;
use std::time::{Duration, Instant};

#[tauri::command]
pub async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    // Default User-Agent so APIs that reject unidentified clients (e.g. GitHub's REST API)
    // work out of the box; a request-level `User-Agent` header below still overrides this.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("Relay/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let method = Method::from_str(&payload.method.to_uppercase()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, &payload.url);

    for (k, v) in &payload.headers {
        req = req.header(k, v);
    }

    if let Some(fields) = payload.form_data {
        let mut form = Form::new();
        for field in fields {
            if field.key.trim().is_empty() {
                continue;
            }
            if field.is_file {
                let bytes = tokio::fs::read(&field.value)
                    .await
                    .map_err(|e| format!("Failed to read file \"{}\": {}", field.value, e))?;
                let file_name = Path::new(&field.value)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "file".to_string());
                form = form.part(field.key, Part::bytes(bytes).file_name(file_name));
            } else {
                form = form.text(field.key, field.value);
            }
        }
        req = req.multipart(form);
    } else if let Some(body) = payload.body {
        req = req.body(body);
    }

    let start = Instant::now();
    let res = req.send().await.map_err(|e| e.to_string())?;

    let status = res.status();
    let headers: Vec<(String, String)> = res
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let body_bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let time_ms = start.elapsed().as_millis();
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponsePayload {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        ok: status.is_success(),
        time_ms,
        size_bytes: body_bytes.len(),
        headers,
        body,
    })
}
