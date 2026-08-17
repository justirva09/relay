// A local stand-in HTTP server — not the real backend. It knows the *shape*
// of a workspace's HTTP requests (method + path) and replies with whatever
// example response is on hand for that request (the same local response
// cache the app already keeps), so a frontend can develop against an API
// that isn't running yet, without touching a real staging/prod server.
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::{body::Body, Router};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tokio::sync::oneshot;

pub struct MockServerState(pub Mutex<Option<(oneshot::Sender<()>, u16)>>);

impl Default for MockServerState {
    fn default() -> Self {
        MockServerState(Mutex::new(None))
    }
}

struct MockRoute {
    method: String,
    path_template: String,
    status: u16,
    body: String,
}

// OpenAPI/Postman-style URLs often start with a "{{base_url}}"-type variable
// or a full scheme+host — a mock server only cares about the path.
fn extract_path_template(url: &str) -> String {
    let mut s = url.trim();
    if let Some(rest) = s.strip_prefix("{{") {
        if let Some(end) = rest.find("}}") {
            s = &rest[end + 2..];
        }
    }
    if let Some(scheme_end) = s.find("://") {
        let after_scheme = &s[scheme_end + 3..];
        s = match after_scheme.find('/') {
            Some(slash) => &after_scheme[slash..],
            None => "/",
        };
    }
    let s = s.split('?').next().unwrap_or(s);
    if s.is_empty() {
        "/".to_string()
    } else if !s.starts_with('/') {
        format!("/{s}")
    } else {
        s.to_string()
    }
}

fn path_matches(template: &str, actual: &str) -> bool {
    let t: Vec<&str> = template.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let a: Vec<&str> = actual.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    if t.len() != a.len() {
        return false;
    }
    t.iter().zip(a.iter()).all(|(tp, ap)| tp.starts_with(':') || tp == ap)
}

fn collect_http_requests(tree: &Value, out: &mut Vec<(String, String, String)>) {
    let Some(nodes) = tree.as_array() else { return };
    for node in nodes {
        match node.get("kind").and_then(|v| v.as_str()) {
            Some("folder") => {
                if let Some(children) = node.get("children") {
                    collect_http_requests(children, out);
                }
            }
            Some("request") => {
                let id = node.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let request = node.get("request");
                let method = request.and_then(|r| r.get("method")).and_then(|v| v.as_str()).unwrap_or("GET").to_uppercase();
                let url = request.and_then(|r| r.get("url")).and_then(|v| v.as_str()).unwrap_or("");
                out.push((method, extract_path_template(url), id));
            }
            _ => {}
        }
    }
}

fn build_routes(workspace: &Value, response_cache: &Value) -> Vec<MockRoute> {
    let mut raw = Vec::new();
    if let Some(tree) = workspace.get("tree") {
        collect_http_requests(tree, &mut raw);
    }
    raw.into_iter()
        .map(|(method, path_template, id)| {
            let cached = response_cache.get(&id).filter(|c| c.get("kind").and_then(|v| v.as_str()) == Some("http"));
            let (status, body) = match cached.and_then(|c| c.get("response")) {
                Some(resp) => {
                    let status = resp.get("status").and_then(|v| v.as_u64()).unwrap_or(200) as u16;
                    let body = resp.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    (status, body)
                }
                None => (
                    200,
                    serde_json::json!({
                        "mock": true,
                        "note": "No cached example yet for this request — send it once in Relay to capture a real example response."
                    })
                    .to_string(),
                ),
            };
            MockRoute { method, path_template, status, body }
        })
        .collect()
}

fn json_response(status: u16, body: String) -> Response {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap()
}

async fn fallback_handler(State(routes): State<Arc<Vec<MockRoute>>>, req: axum::extract::Request) -> impl IntoResponse {
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    for route in routes.iter() {
        if route.method == method && path_matches(&route.path_template, &path) {
            return json_response(route.status, route.body.clone());
        }
    }
    json_response(
        404,
        serde_json::json!({
            "mock": true,
            "error": format!("No request matching {method} {path} in this workspace's collection")
        })
        .to_string(),
    )
}

#[tauri::command]
pub async fn start_mock_server(
    app: AppHandle,
    state: tauri::State<'_, MockServerState>,
    workspace_dir: String,
    port: u16,
) -> Result<(), String> {
    if let Some((tx, _)) = state.0.lock().unwrap().take() {
        let _ = tx.send(());
    }

    let workspace_raw = crate::storage::load_workspace_dir(workspace_dir.clone())?;
    let envelope: Value = serde_json::from_str(&workspace_raw).map_err(|e| e.to_string())?;
    let workspace = envelope.get("workspace").cloned().unwrap_or(Value::Null);
    if workspace.is_null() {
        return Err("No workspace found at this folder yet".to_string());
    }

    let cache_raw = crate::response_cache::load_response_cache(app, workspace_dir).unwrap_or_else(|_| "{}".to_string());
    let response_cache: Value = serde_json::from_str(&cache_raw).unwrap_or_else(|_| serde_json::json!({}));

    let routes = Arc::new(build_routes(&workspace, &response_cache));
    let router = Router::new().fallback(any(fallback_handler)).with_state(routes);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Failed to bind 127.0.0.1:{port} — {e}"))?;

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
    });

    *state.0.lock().unwrap() = Some((tx, port));
    Ok(())
}

#[tauri::command]
pub fn stop_mock_server(state: tauri::State<'_, MockServerState>) -> Result<(), String> {
    if let Some((tx, _)) = state.0.lock().unwrap().take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn mock_server_status(state: tauri::State<'_, MockServerState>) -> Option<u16> {
    state.0.lock().unwrap().as_ref().map(|(_, port)| *port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_path_from_variable_prefixed_url() {
        assert_eq!(extract_path_template("{{base_url}}/v1/users/:id"), "/v1/users/:id");
    }

    #[test]
    fn extracts_path_from_full_url() {
        assert_eq!(extract_path_template("https://api.example.com/v1/users?limit=5"), "/v1/users");
    }

    #[test]
    fn matches_path_params() {
        assert!(path_matches("/v1/users/:id", "/v1/users/42"));
        assert!(!path_matches("/v1/users/:id", "/v1/users"));
        assert!(!path_matches("/v1/users/:id", "/v1/users/42/orders"));
    }
}
