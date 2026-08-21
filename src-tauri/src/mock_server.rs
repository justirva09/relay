// Local mock server. Matches method + path against saved examples or the
// response cache, no real backend needed.
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

#[derive(Debug)]
struct ResolvedExample {
    status: u16,
    body: String,
    // Headers saved on the example itself, e.g. a custom Content-Type for a non-JSON body.
    headers: Vec<(String, String)>,
    is_default: bool,
    // Scenario key for X-Mock-Scenario matching, resolved once here.
    key: String,
}

// Hop-by-hop headers tied to the original connection. A saved example can
// carry a stale Content-Length or chunked encoding that breaks response
// framing if forwarded, so let axum/hyper compute these instead.
const NON_FORWARDABLE_HEADERS: [&str; 6] = ["content-length", "transfer-encoding", "connection", "keep-alive", "host", "content-encoding"];

// Example.headers is [string, string][] on the TS side, parsed leniently
// so one malformed row doesn't fail the whole example.
fn parse_example_headers(value: &Value) -> Vec<(String, String)> {
    value
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let pair = row.as_array()?;
                    let k = pair.first()?.as_str()?.trim();
                    let v = pair.get(1)?.as_str()?;
                    if k.is_empty() || NON_FORWARDABLE_HEADERS.contains(&k.to_ascii_lowercase().as_str()) {
                        None
                    } else {
                        Some((k.to_string(), v.to_string()))
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

struct MockRoute {
    method: String,
    path_template: String,
    examples: Vec<ResolvedExample>,
}

// Slug derived from the example name, so "Not Found" matches
// X-Mock-Scenario: not-found. Same algorithm runs on the TS side.
fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut last_was_dash = true; // swallow leading dashes
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

// Strip a {{base_url}}-style var or a full scheme+host, the mock server only needs the path.
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

fn collect_http_requests(tree: &Value, out: &mut Vec<(String, String, String, Value)>) {
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
                let examples = request.and_then(|r| r.get("examples")).cloned().unwrap_or(Value::Null);
                out.push((method, extract_path_template(url), id, examples));
            }
            _ => {}
        }
    }
}

fn resolve_examples(examples: &Value, cached_response: Option<&Value>) -> Vec<ResolvedExample> {
    if let Some(arr) = examples.as_array().filter(|a| !a.is_empty()) {
        let has_default = arr.iter().any(|e| e.get("isDefault").and_then(|v| v.as_bool()) == Some(true));
        return arr
            .iter()
            .enumerate()
            .map(|(i, e)| {
                let name = e.get("name").and_then(|v| v.as_str()).unwrap_or("example");
                // Explicit scenarioKey overrides the name-derived slug; a blank one falls back to the name.
                let key = e
                    .get("scenarioKey")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(slugify)
                    .unwrap_or_else(|| slugify(name));
                ResolvedExample {
                    status: e.get("status").and_then(|v| v.as_u64()).unwrap_or(200) as u16,
                    body: e.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    headers: e.get("headers").map(parse_example_headers).unwrap_or_default(),
                    // isDefault flag, else first example, resolved once here.
                    is_default: e.get("isDefault").and_then(|v| v.as_bool()).unwrap_or(false) || (!has_default && i == 0),
                    key,
                }
            })
            .collect();
    }
    // No saved examples: fall back to the cached response, then a placeholder.
    match cached_response {
        Some(resp) => vec![ResolvedExample {
            status: resp.get("status").and_then(|v| v.as_u64()).unwrap_or(200) as u16,
            body: resp.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            headers: Vec::new(),
            is_default: true,
            key: "cached-response".to_string(),
        }],
        None => vec![ResolvedExample {
            status: 200,
            body: serde_json::json!({
                "mock": true,
                "note": "No example yet for this request — send it once and use \"Save as example\" in the response panel."
            })
            .to_string(),
            headers: Vec::new(),
            is_default: true,
            key: "default".to_string(),
        }],
    }
}

fn build_routes(workspace: &Value, response_cache: &Value) -> Vec<MockRoute> {
    let mut raw = Vec::new();
    if let Some(tree) = workspace.get("tree") {
        collect_http_requests(tree, &mut raw);
    }
    raw.into_iter()
        .map(|(method, path_template, id, examples)| {
            let cached = response_cache
                .get(&id)
                .filter(|c| c.get("kind").and_then(|v| v.as_str()) == Some("http"))
                .and_then(|c| c.get("response"));
            MockRoute { method, path_template, examples: resolve_examples(&examples, cached) }
        })
        .collect()
}

// Matches X-Mock-Scenario against resolved keys; no header means use the
// default. An unrecognized key returns an error instead of silently
// falling back.
fn pick_example<'a>(examples: &'a [ResolvedExample], scenario: Option<&str>) -> Result<&'a ResolvedExample, Vec<String>> {
    if let Some(key) = scenario {
        let wanted = slugify(key);
        if let Some(ex) = examples.iter().find(|e| e.key == wanted) {
            return Ok(ex);
        }
        return Err(examples.iter().map(|e| e.key.clone()).collect());
    }
    examples
        .iter()
        .find(|e| e.is_default)
        .or_else(|| examples.first())
        .ok_or_else(Vec::new)
}

fn json_response(status: u16, body: String) -> Response {
    example_response(status, body, &[])
}

// Same as json_response but layers the example's saved headers on top, so
// an explicit Content-Type overrides the JSON default.
fn example_response(status: u16, body: String, headers: &[(String, String)]) -> Response {
    let mut builder = Response::builder().status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK));
    if !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-type")) {
        builder = builder.header("content-type", "application/json");
    }
    for (k, v) in headers {
        // A captured header value can contain bytes HeaderValue rejects.
        // .body() below would panic on it, so validate up front and skip
        // the bad one instead of crashing the whole response.
        if axum::http::HeaderName::from_bytes(k.as_bytes()).is_ok() && axum::http::HeaderValue::from_str(v).is_ok() {
            builder = builder.header(k, v);
        }
    }
    builder.body(Body::from(body)).unwrap()
}

struct MockContext {
    app: AppHandle,
    workspace_dir: String,
}

// Re-reads workspace + cache from disk on every request so edits apply
// without restarting the server. Fine for a local dev tool with occasional traffic.
fn load_routes(ctx: &MockContext) -> Vec<MockRoute> {
    let workspace_raw = match crate::storage::load_workspace_dir(ctx.workspace_dir.clone()) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let envelope: Value = match serde_json::from_str(&workspace_raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let workspace = envelope.get("workspace").cloned().unwrap_or(Value::Null);
    if workspace.is_null() {
        return Vec::new();
    }
    let cache_raw = crate::response_cache::load_response_cache(ctx.app.clone(), ctx.workspace_dir.clone()).unwrap_or_else(|_| "{}".to_string());
    let response_cache: Value = serde_json::from_str(&cache_raw).unwrap_or_else(|_| serde_json::json!({}));
    build_routes(&workspace, &response_cache)
}

async fn fallback_handler(State(ctx): State<Arc<MockContext>>, req: axum::extract::Request) -> impl IntoResponse {
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let scenario = req.headers().get("x-mock-scenario").and_then(|v| v.to_str().ok()).map(str::to_string);
    let routes = load_routes(&ctx);
    for route in routes.iter() {
        if route.method == method && path_matches(&route.path_template, &path) {
            return match pick_example(&route.examples, scenario.as_deref()) {
                Ok(example) => example_response(example.status, example.body.clone(), &example.headers),
                Err(available) => json_response(
                    404,
                    serde_json::json!({
                        "mock": true,
                        "error": format!("No scenario named \"{}\" on this request", scenario.unwrap_or_default()),
                        "available_scenarios": available
                    })
                    .to_string(),
                ),
            };
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

    // Fail fast if there's no workspace yet; once running, load_routes
    // just 404s on transient read errors instead of crashing.
    let workspace_raw = crate::storage::load_workspace_dir(workspace_dir.clone())?;
    let envelope: Value = serde_json::from_str(&workspace_raw).map_err(|e| e.to_string())?;
    if envelope.get("workspace").map(|w| w.is_null()).unwrap_or(true) {
        return Err("No workspace found at this folder yet".to_string());
    }

    let ctx = Arc::new(MockContext { app, workspace_dir });
    let router = Router::new().fallback(any(fallback_handler)).with_state(ctx);

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

    fn request_node(id: &str, method: &str, url: &str, examples: Value) -> Value {
        serde_json::json!({
            "id": id, "kind": "request", "name": id,
            "request": { "method": method, "url": url, "examples": examples }
        })
    }

    #[test]
    fn slugify_matches_the_frontend_scheme() {
        assert_eq!(slugify("Not Found"), "not-found");
        assert_eq!(slugify("200 OK"), "200-ok");
        assert_eq!(slugify("  Unauthorized!! "), "unauthorized");
    }

    #[test]
    fn build_routes_prefers_persisted_example_over_response_cache() {
        let workspace = serde_json::json!({
            "tree": [request_node(
                "req-1", "GET", "/v1/portfolio/:id",
                serde_json::json!([{ "id": "e1", "name": "Not Found", "status": 404, "body": "{\"code\":\"NOT_FOUND\"}", "isDefault": true }])
            )]
        });
        // Stale cache from an old send, ignored once an example exists.
        let cache = serde_json::json!({ "req-1": { "kind": "http", "response": { "status": 200, "body": "stale" } } });
        let routes = build_routes(&workspace, &cache);
        assert_eq!(routes.len(), 1);
        let picked = pick_example(&routes[0].examples, None).unwrap();
        assert_eq!(picked.status, 404);
        assert_eq!(picked.body, "{\"code\":\"NOT_FOUND\"}");
    }

    #[test]
    fn build_routes_falls_back_to_response_cache_without_examples() {
        let workspace = serde_json::json!({ "tree": [request_node("req-1", "GET", "/v1/users", Value::Null)] });
        let cache = serde_json::json!({ "req-1": { "kind": "http", "response": { "status": 201, "body": "created" } } });
        let routes = build_routes(&workspace, &cache);
        let picked = pick_example(&routes[0].examples, None).unwrap();
        assert_eq!(picked.status, 201);
        assert_eq!(picked.body, "created");
    }

    fn examples_fixture() -> Vec<ResolvedExample> {
        resolve_examples(
            &serde_json::json!([
                { "name": "Success", "status": 200, "body": "ok", "isDefault": true },
                { "name": "Not Found", "status": 404, "body": "nf" },
                { "name": "Server Error", "status": 500, "body": "err" },
            ]),
            None,
        )
    }

    #[test]
    fn pick_example_uses_default_when_no_scenario_requested() {
        let examples = examples_fixture();
        assert_eq!(pick_example(&examples, None).unwrap().status, 200);
    }

    #[test]
    fn pick_example_matches_scenario_header_by_slug() {
        let examples = examples_fixture();
        assert_eq!(pick_example(&examples, Some("not-found")).unwrap().status, 404);
        // Case/whitespace-insensitive, same slugify() on both sides.
        assert_eq!(pick_example(&examples, Some("Server Error")).unwrap().status, 500);
    }

    #[test]
    fn pick_example_reports_available_scenarios_on_unknown_key() {
        let examples = examples_fixture();
        let err = pick_example(&examples, Some("bogus")).unwrap_err();
        assert_eq!(err, vec!["success", "not-found", "server-error"]);
    }

    #[test]
    fn resolve_examples_defaults_to_first_when_none_flagged() {
        let examples = resolve_examples(
            &serde_json::json!([{ "name": "a", "status": 404, "body": "x" }, { "name": "b", "status": 200, "body": "y" }]),
            None,
        );
        assert!(examples[0].is_default);
        assert!(!examples[1].is_default);
    }

    #[test]
    fn scenario_key_override_wins_over_the_slugified_name() {
        let examples = resolve_examples(
            &serde_json::json!([
                { "name": "Portfolio — Not Found", "status": 404, "body": "nf", "scenarioKey": "not-found" },
            ]),
            None,
        );
        assert_eq!(examples[0].key, "not-found");
        assert_eq!(pick_example(&examples, Some("not-found")).unwrap().status, 404);
    }

    #[test]
    fn blank_scenario_key_falls_back_to_slugified_name() {
        let examples = resolve_examples(&serde_json::json!([{ "name": "New Example", "status": 200, "body": "ok", "scenarioKey": "  " }]), None);
        assert_eq!(examples[0].key, "new-example");
    }

    #[test]
    fn parse_example_headers_skips_malformed_rows() {
        let headers = parse_example_headers(&serde_json::json!([
            ["X-Custom", "yes"],
            ["", "should be skipped: empty key"],
            ["only-one-element"],
            "not even an array",
            ["X-Other", "value"],
        ]));
        assert_eq!(headers, vec![("X-Custom".to_string(), "yes".to_string()), ("X-Other".to_string(), "value".to_string())]);
    }

    #[test]
    fn parse_example_headers_drops_hop_by_hop_headers() {
        // Real bug once: a captured Content-Length/Transfer-Encoding against
        // a differently-sized mock body broke response framing. Server
        // showed "Running" but every request failed with a connection error.
        let headers = parse_example_headers(&serde_json::json!([
            ["Content-Length", "1234"],
            ["Transfer-Encoding", "chunked"],
            ["Connection", "keep-alive"],
            ["X-Real-Header", "kept"],
        ]));
        assert_eq!(headers, vec![("X-Real-Header".to_string(), "kept".to_string())]);
    }

    #[test]
    fn resolve_examples_parses_the_headers_field() {
        let examples = resolve_examples(
            &serde_json::json!([{ "name": "a", "status": 200, "body": "ok", "headers": [["X-Custom", "yes"]] }]),
            None,
        );
        assert_eq!(examples[0].headers, vec![("X-Custom".to_string(), "yes".to_string())]);
    }

    fn header_value<'a>(resp: &'a Response, name: &str) -> Option<&'a str> {
        resp.headers().get(name).and_then(|v| v.to_str().ok())
    }

    #[test]
    fn example_response_sends_custom_headers_and_defaults_content_type_to_json() {
        let resp = example_response(200, "{}".to_string(), &[("X-Custom".to_string(), "yes".to_string())]);
        assert_eq!(header_value(&resp, "x-custom"), Some("yes"));
        assert_eq!(header_value(&resp, "content-type"), Some("application/json"));
    }

    #[test]
    fn example_response_custom_content_type_overrides_the_json_default() {
        let resp = example_response(200, "<a/>".to_string(), &[("Content-Type".to_string(), "application/xml".to_string())]);
        assert_eq!(header_value(&resp, "content-type"), Some("application/xml"));
        // Exactly one content-type header, not the custom one plus a leftover default.
        assert_eq!(resp.headers().get_all("content-type").iter().count(), 1);
    }

    #[test]
    fn example_response_skips_an_invalid_header_value_instead_of_panicking() {
        // A header value with a raw newline/control char is invalid for
        // HeaderValue, drop it instead of crashing the response.
        let resp = example_response(200, "{}".to_string(), &[("X-Bad".to_string(), "line1\nline2".to_string()), ("X-Good".to_string(), "fine".to_string())]);
        assert_eq!(header_value(&resp, "x-bad"), None);
        assert_eq!(header_value(&resp, "x-good"), Some("fine"));
    }
}
