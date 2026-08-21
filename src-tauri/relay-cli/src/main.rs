// Headless CLI for firing a single request out of a Relay workspace, for CI.
// Reuses the same .relay parsing and HTTP sending code as the desktop app.
//
// v1 scope: no pre/test scripts, no auth block, no path params, no
// form/urlencoded/multipart bodies. Those still only exist as TypeScript in
// the desktop webview (pm.ts, useSendRequest.ts) and haven't been ported to
// Rust yet. This handles plain GET/POST with a JSON or text body and
// {{variable}} substitution, enough for a first CI smoke-test.
use relay::commands::http_request;
use relay::git::git_branch_diff;
use relay::models::HttpRequestPayload;
use relay::storage::load_workspace_dir;
use serde_json::Value;
use std::collections::HashMap;
use std::io::IsTerminal;
use std::process::ExitCode;

fn print_usage() {
    eprintln!(
        "relay-cli {}\n\n\
Usage:\n  \
relay-cli run <workspace-dir> <request-name-substring> [--env <name>] [--json]\n  \
relay-cli check <workspace-dir> [--ci] [--json]\n  \
relay-cli diff <workspace-dir> <base-ref> [compare-ref] [--ci] [--json]\n  \
relay-cli --version | -v\n  \
relay-cli --help | -h\n\n\
Options (run):\n  \
--env <name>   Overlay this environment's variables over Globals\n  \
--json         Print the full response payload as JSON (status/headers/body/timing) instead of a human summary\n\n\
Options (check, diff):\n  \
--ci           Flat, one-line-per-item output suited to CI logs (same data, no box layout)\n  \
--json         Print the full results as JSON\n\n\
Exit code (run): 0 on a 2xx response, 1 on any failure (no match, network error, non-2xx).\n\
Exit code (check): 0 if every check passes or only warns, 1 if any check fails (✗).\n\
Exit code (diff): 0 if no breaking change is found, 1 if any is — safe to use as a CI gate either way; --ci only changes the output format, not the exit code.\n\n\
diff compares <base-ref> against <compare-ref> (a branch, tag, or commit), or against the working tree (including uncommitted changes) if compare-ref is omitted — same semantics as the desktop app's Compare Branches panel. It flags a change breaking when: the request was deleted, its method or URL changed, auth became newly required where it wasn't before, or a saved example response's default snapshot lost a field or changed a field's type (e.g. a number becoming a string) — this last one only works for requests that have a default example saved, since Relay doesn't otherwise keep response history.\n\n\
Not yet run by relay-cli (desktop-only for now): pre/test scripts, the Auth tab, path params, form/urlencoded/multipart bodies.\n\
If a matched request has any of these, relay-cli prints a note to stderr and sends what it can instead of silently dropping them.",
        env!("CARGO_PKG_VERSION")
    );
}

fn print_version() {
    println!("relay-cli {}", env!("CARGO_PKG_VERSION"));
}

// Mirrors substituteVars in src/lib/pm.ts: {{ key }} gets replaced when
// known, left as-is when the key isn't in `vars`.
fn substitute_vars(input: &str, vars: &HashMap<String, String>) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '{' && i + 1 < chars.len() && chars[i + 1] == '{' {
            let mut j = i + 2;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            let key_start = j;
            while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_' || chars[j] == '.' || chars[j] == '-') {
                j += 1;
            }
            let key_end = j;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if key_end > key_start && j + 1 < chars.len() && chars[j] == '}' && chars[j + 1] == '}' {
                let key: String = chars[key_start..key_end].iter().collect();
                if let Some(val) = vars.get(&key) {
                    out.push_str(val);
                    i = j + 2;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn kvrows_into_map(rows: &[Value], out: &mut HashMap<String, String>) {
    for row in rows {
        let key = row.get("key").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if key.is_empty() {
            continue;
        }
        let value = row.get("value").and_then(Value::as_str).unwrap_or("").to_string();
        out.insert(key, value);
    }
}

// Depth-first search for the first HTTP request whose name contains needle
// (case-insensitive), same shape as the Runner's flattenRequests.
fn find_request<'a>(nodes: &'a [Value], needle: &str) -> Option<(&'a str, &'a Value)> {
    for node in nodes {
        let kind = node.get("kind").and_then(Value::as_str).unwrap_or("");
        let name = node.get("name").and_then(Value::as_str).unwrap_or("");
        if kind == "request" && name.to_lowercase().contains(needle) {
            if let Some(request) = node.get("request") {
                return Some((name, request));
            }
        }
        if kind == "folder" {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                if let Some(found) = find_request(children, needle) {
                    return Some(found);
                }
            }
        }
    }
    None
}

#[derive(Clone, Copy, PartialEq, serde::Serialize)]
enum Status {
    #[serde(rename = "pass")]
    Pass,
    #[serde(rename = "warn")]
    Warn,
    #[serde(rename = "fail")]
    Fail,
}

const ANSI_RESET: &str = "\x1b[0m";
const ANSI_BOLD: &str = "\x1b[1m";
const ANSI_DIM: &str = "\x1b[2m";
const ANSI_GREEN: &str = "\x1b[32m";
const ANSI_YELLOW: &str = "\x1b[33m";
const ANSI_RED: &str = "\x1b[31m";

impl Status {
    fn glyph(self) -> &'static str {
        match self {
            Status::Pass => "✓",
            Status::Warn => "⚠",
            Status::Fail => "✗",
        }
    }

    fn color(self) -> &'static str {
        match self {
            Status::Pass => ANSI_GREEN,
            Status::Warn => ANSI_YELLOW,
            Status::Fail => ANSI_RED,
        }
    }
}

#[derive(serde::Serialize)]
struct CheckItem {
    label: String,
    status: Status,
    detail: String,
}

// Depth-first walk collecting every request node (http + grpc), used by
// `check`'s counts below. Unlike find_request, this visits everything.
fn collect_requests<'a>(nodes: &'a [Value], out: &mut Vec<&'a Value>) {
    for node in nodes {
        let kind = node.get("kind").and_then(Value::as_str).unwrap_or("");
        if kind == "request" || kind == "grpc" {
            out.push(node);
        } else if kind == "folder" {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                collect_requests(children, out);
            }
        }
    }
}

// Scans for a KVRow with "secret": true and a non-empty value. storage.rs's
// save path should never let that land in a tracked, non-.secret.relay file,
// so a hit here means a real secret ended up in git somehow.
fn find_leaked_secrets(value: &Value, path: &str, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            let is_secret_row = map.get("secret").and_then(Value::as_bool) == Some(true);
            let non_empty_value = map.get("value").and_then(Value::as_str).map(|v| !v.is_empty()).unwrap_or(false);
            if is_secret_row && non_empty_value {
                let key = map.get("key").and_then(Value::as_str).unwrap_or("?");
                out.push(format!("{path}: key \"{key}\""));
            }
            for v in map.values() {
                find_leaked_secrets(v, path, out);
            }
        }
        Value::Array(items) => {
            for v in items {
                find_leaked_secrets(v, path, out);
            }
        }
        _ => {}
    }
}

fn run_check(dir: &str) -> Vec<CheckItem> {
    let mut items = Vec::new();

    let raw = load_workspace_dir(dir.to_string());
    let workspace = raw
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|parsed| parsed.get("workspace").filter(|w| !w.is_null()).cloned());

    let Some(workspace) = workspace else {
        items.push(CheckItem {
            label: "Collections".to_string(),
            status: Status::Fail,
            detail: format!("no Relay workspace found in \"{dir}\""),
        });
        return items;
    };

    let tree = workspace.get("tree").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut requests: Vec<&Value> = Vec::new();
    collect_requests(&tree, &mut requests);

    items.push(CheckItem {
        label: "Collections".to_string(),
        status: if requests.is_empty() { Status::Warn } else { Status::Pass },
        detail: format!("{} request{}", requests.len(), if requests.len() == 1 { "" } else { "s" }),
    });

    let env_count = workspace.get("environments").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
    items.push(CheckItem {
        label: "Environments".to_string(),
        status: Status::Pass,
        detail: format!("{env_count} environment{}", if env_count == 1 { "" } else { "s" }),
    });

    let http_requests: Vec<&&Value> = requests.iter().filter(|r| r.get("kind").and_then(Value::as_str) == Some("request")).collect();
    let missing_assertions = http_requests
        .iter()
        .filter(|r| {
            r.get("request")
                .and_then(|req| req.get("testScript"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .is_empty()
        })
        .count();
    items.push(CheckItem {
        label: "Assertions".to_string(),
        status: if missing_assertions > 0 { Status::Warn } else { Status::Pass },
        detail: if missing_assertions > 0 {
            format!(
                "{missing_assertions} request{} {} no assertions",
                if missing_assertions == 1 { "" } else { "s" },
                if missing_assertions == 1 { "has" } else { "have" }
            )
        } else {
            "every request has at least one assertion".to_string()
        },
    });

    let example_count: usize = http_requests
        .iter()
        .map(|r| r.get("request").and_then(|req| req.get("examples")).and_then(Value::as_array).map(|a| a.len()).unwrap_or(0))
        .sum();
    items.push(CheckItem {
        label: "Mock".to_string(),
        status: Status::Pass,
        detail: format!("{example_count} endpoint{}", if example_count == 1 { "" } else { "s" }),
    });

    // Git checks are best-effort; no repo isn't an error, just reported as such.
    let git_status_out = std::process::Command::new("git").args(["status", "--porcelain"]).current_dir(dir).output();
    match git_status_out {
        Ok(out) if out.status.success() => {
            let clean = out.stdout.is_empty();
            items.push(CheckItem {
                label: "Git".to_string(),
                status: if clean { Status::Pass } else { Status::Warn },
                detail: if clean {
                    "clean".to_string()
                } else {
                    let n = String::from_utf8_lossy(&out.stdout).lines().count();
                    format!("{n} uncommitted change{}", if n == 1 { "" } else { "s" })
                },
            });

            let mut leaks: Vec<String> = Vec::new();
            if let Ok(ls) = std::process::Command::new("git").args(["ls-files"]).current_dir(dir).output() {
                if ls.status.success() {
                    for tracked in String::from_utf8_lossy(&ls.stdout).lines() {
                        if !tracked.ends_with(".relay") {
                            continue;
                        }
                        if tracked.ends_with(".secret.relay") {
                            leaks.push(format!("{tracked}: gitignored secret file is tracked"));
                            continue;
                        }
                        if let Ok(content) = std::fs::read_to_string(std::path::Path::new(dir).join(tracked)) {
                            if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
                                find_leaked_secrets(&parsed, tracked, &mut leaks);
                            }
                        }
                    }
                }
            }
            items.push(CheckItem {
                label: "Secrets".to_string(),
                status: if leaks.is_empty() { Status::Pass } else { Status::Fail },
                detail: if leaks.is_empty() {
                    "no secret values committed to git".to_string()
                } else {
                    format!("{} secret{} committed to git ({})", leaks.len(), if leaks.len() == 1 { "" } else { "s" }, leaks.join("; "))
                },
            });
        }
        _ => {
            items.push(CheckItem {
                label: "Git".to_string(),
                status: Status::Warn,
                detail: "not a git repository".to_string(),
            });
        }
    }

    items
}

fn print_check_pretty(items: &[CheckItem]) {
    let color = std::io::stdout().is_terminal();
    let (bold, dim, reset) = if color { (ANSI_BOLD, ANSI_DIM, ANSI_RESET) } else { ("", "", "") };
    let label_width = items.iter().map(|i| i.label.chars().count()).max().unwrap_or(0);

    println!("{bold}Relay Check{reset}");
    println!("{dim}{}{reset}", "─".repeat(label_width + 2));
    println!();
    for item in items {
        let (c, r) = if color { (item.status.color(), reset) } else { ("", "") };
        println!("{c}{}{r}  {bold}{:<label_width$}{reset}  {}", item.status.glyph(), item.label, item.detail);
    }
    println!();

    let pass = items.iter().filter(|i| i.status == Status::Pass).count();
    let warn = items.iter().filter(|i| i.status == Status::Warn).count();
    let fail = items.iter().filter(|i| i.status == Status::Fail).count();
    let (pc, wc, fc) = if color { (ANSI_GREEN, ANSI_YELLOW, ANSI_RED) } else { ("", "", "") };
    println!(
        "{pc}{pass} passed{reset} {dim}·{reset} {wc}{warn} warning{ws}{reset} {dim}·{reset} {fc}{fail} failed{fs}{reset}",
        ws = if warn == 1 { "" } else { "s" },
        fs = if fail == 1 { "" } else { "s" }
    );
}

fn print_check_ci(items: &[CheckItem]) {
    for item in items {
        let tag = match item.status {
            Status::Pass => "PASS",
            Status::Warn => "WARN",
            Status::Fail => "FAIL",
        };
        println!("[{tag}] {}: {}", item.label, item.detail);
    }
}

fn cmd_check(args: &[String]) -> ExitCode {
    if args.is_empty() {
        print_usage();
        return ExitCode::FAILURE;
    }
    let dir = args[0].clone();
    let mut ci = false;
    let mut json_output = false;
    for arg in &args[1..] {
        match arg.as_str() {
            "--ci" => ci = true,
            "--json" => json_output = true,
            other => {
                eprintln!("Unknown argument: {other}");
                print_usage();
                return ExitCode::FAILURE;
            }
        }
    }

    let items = run_check(&dir);
    let any_fail = items.iter().any(|i| i.status == Status::Fail);

    if json_output {
        println!("{}", serde_json::to_string_pretty(&items).unwrap_or_default());
    } else if ci {
        print_check_ci(&items);
    } else {
        print_check_pretty(&items);
    }

    if any_fail {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

// Ports diffRequestData/isBreaking/describeBreaking from src/lib/apiDiff.ts
// so relay-cli's breaking-change classification matches the desktop app.

#[derive(serde::Serialize)]
struct DiffEntryResult {
    path: String,
    status: String,
    method: String,
    url: String,
    changes: Vec<String>,
    breaking: bool,
    reasons: Vec<String>,
}

fn url_base(url: &str) -> &str {
    match url.find('?') {
        Some(i) => &url[..i],
        None => url,
    }
}

fn auth_summary(auth: &Value) -> String {
    let t = auth.get("type").and_then(Value::as_str).unwrap_or("none");
    match t {
        "bearer" => format!("Bearer {}", auth.get("bearer").and_then(|b| b.get("token")).and_then(Value::as_str).unwrap_or("")),
        "basic" => format!("Basic {}", auth.get("basic").and_then(|b| b.get("username")).and_then(Value::as_str).unwrap_or("")),
        _ => "No Auth".to_string(),
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let k = key.to_lowercase();
    ["token", "secret", "password", "apikey", "api_key", "api-key", "auth"].iter().any(|s| k.contains(s))
}

// KVRow-array diff (query params or headers), mirrors diffRows in apiDiff.ts.
fn diff_kvrows(before: &[Value], after: &[Value], label: &str, flag_sensitive: bool) -> (Vec<String>, bool) {
    let mut lines = Vec::new();
    let mut sensitive_hit = false;
    let enabled_map = |rows: &[Value]| -> HashMap<String, String> {
        rows.iter()
            .filter(|r| r.get("enabled").and_then(Value::as_bool).unwrap_or(true))
            .filter_map(|r| {
                let k = r.get("key").and_then(Value::as_str).unwrap_or("").trim().to_string();
                if k.is_empty() {
                    None
                } else {
                    Some((k.to_lowercase(), r.get("value").and_then(Value::as_str).unwrap_or("").to_string()))
                }
            })
            .collect()
    };
    let before_map = enabled_map(before);
    let after_map = enabled_map(after);
    for (k, v) in &after_map {
        let sensitive = flag_sensitive && is_sensitive_key(k);
        match before_map.get(k) {
            None => {
                if sensitive {
                    sensitive_hit = true;
                }
                lines.push(format!("+ {label}: {k}={v}{}", if sensitive { "  ⚠ sensitive" } else { "" }));
            }
            Some(prev) if prev != v => lines.push(format!("~ {label} {k}: {prev} → {v}")),
            _ => {}
        }
    }
    for k in before_map.keys() {
        if !after_map.contains_key(k) {
            lines.push(format!("- {label}: {k}"));
        }
    }
    (lines, sensitive_hit)
}

fn json_type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

// Compares two JSON values field-by-field, reporting a line for every leaf
// whose type changed, was removed, or was added. Doesn't descend into
// arrays, each one's compared as a single type-slot, kept simple for v1.
fn diff_json_shape(before: &Value, after: &Value, path: &str, out: &mut Vec<(String, bool)>) {
    match (before, after) {
        (Value::Object(b), Value::Object(a)) => {
            for (k, av) in a {
                let child = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
                match b.get(k) {
                    Some(bv) => diff_json_shape(bv, av, &child, out),
                    None => out.push((format!("response.{child}: added ({})", json_type_name(av)), false)),
                }
            }
            for (k, bv) in b {
                if !a.contains_key(k) {
                    out.push((format!("response.{}: removed (was {})", if path.is_empty() { k.clone() } else { format!("{path}.{k}") }, json_type_name(bv)), true));
                }
            }
        }
        _ => {
            let (bt, at) = (json_type_name(before), json_type_name(after));
            if bt != at {
                out.push((format!("response.{path}: {bt} → {at}"), true));
            }
        }
    }
}

// Finds the default mock example (isDefault, or the first one) and returns
// its parsed body if it's a JSON object, the only shape diff_json_shape can compare.
fn default_example_body(request: &Value) -> Option<Value> {
    let examples = request.get("examples").and_then(Value::as_array)?;
    let chosen = examples.iter().find(|e| e.get("isDefault").and_then(Value::as_bool) == Some(true)).or_else(|| examples.first())?;
    let body_str = chosen.get("body").and_then(Value::as_str)?;
    let parsed: Value = serde_json::from_str(body_str).ok()?;
    if parsed.is_object() {
        Some(parsed)
    } else {
        None
    }
}

fn diff_request(before: &Value, after: &Value) -> (Vec<String>, bool, Vec<String>) {
    let mut changes = Vec::new();
    let mut reasons = Vec::new();
    let mut breaking = false;

    let before_method = before.get("method").and_then(Value::as_str).unwrap_or("");
    let after_method = after.get("method").and_then(Value::as_str).unwrap_or("");
    if before_method != after_method {
        changes.push(format!("~ method: {before_method} → {after_method}"));
        reasons.push(format!("Method changed from {before_method} to {after_method} — apps still sending {before_method} will fail."));
        breaking = true;
    }

    let before_url = url_base(before.get("url").and_then(Value::as_str).unwrap_or(""));
    let after_url = url_base(after.get("url").and_then(Value::as_str).unwrap_or(""));
    if before_url != after_url {
        changes.push(format!("~ url: {before_url} → {after_url}"));
        reasons.push("The URL changed — apps still using the old URL will get a \"not found\" error.".to_string());
        breaking = true;
    }

    let before_auth = auth_summary(before.get("auth").unwrap_or(&Value::Null));
    let after_auth = auth_summary(after.get("auth").unwrap_or(&Value::Null));
    if before_auth != after_auth {
        changes.push(format!("~ auth: {before_auth} → {after_auth}"));
        if before_auth == "No Auth" && after_auth != "No Auth" {
            reasons.push("This now requires login credentials — apps that don't send them will start failing.".to_string());
            breaking = true;
        }
    }

    let empty = Vec::new();
    let before_params = before.get("params").and_then(Value::as_array).unwrap_or(&empty);
    let after_params = after.get("params").and_then(Value::as_array).unwrap_or(&empty);
    let (query_lines, _) = diff_kvrows(before_params, after_params, "query", true);
    changes.extend(query_lines);

    let before_headers = before.get("headers").and_then(Value::as_array).unwrap_or(&empty);
    let after_headers = after.get("headers").and_then(Value::as_array).unwrap_or(&empty);
    let (header_lines, _) = diff_kvrows(before_headers, after_headers, "header", false);
    changes.extend(header_lines);

    let before_body_mode = before.get("bodyMode").and_then(Value::as_str).unwrap_or("none");
    let after_body_mode = after.get("bodyMode").and_then(Value::as_str).unwrap_or("none");
    if before_body_mode != after_body_mode {
        changes.push(format!("~ body mode: {before_body_mode} → {after_body_mode}"));
    } else if (before_body_mode == "json" || before_body_mode == "text")
        && before.get("bodyText").and_then(Value::as_str) != after.get("bodyText").and_then(Value::as_str)
    {
        changes.push("~ body content changed".to_string());
    }

    if let (Some(before_body), Some(after_body)) = (default_example_body(before), default_example_body(after)) {
        let mut shape_diffs = Vec::new();
        diff_json_shape(&before_body, &after_body, "", &mut shape_diffs);
        for (line, is_breaking) in shape_diffs {
            changes.push(format!("~ {line}"));
            if is_breaking {
                reasons.push(format!("{} — clients depending on the old shape may break.", line.trim_start_matches("response.")));
                breaking = true;
            }
        }
    }

    (changes, breaking, reasons)
}

fn build_diffs(entries: &[relay::git::BranchDiffEntry]) -> Vec<DiffEntryResult> {
    let mut results = Vec::new();
    for entry in entries {
        let before: Option<Value> = entry.before.as_deref().and_then(|s| serde_json::from_str(s).ok());
        let after: Option<Value> = entry.after.as_deref().and_then(|s| serde_json::from_str(s).ok());
        let name = after
            .as_ref()
            .and_then(|v| v.get("name"))
            .or_else(|| before.as_ref().and_then(|v| v.get("name")))
            .and_then(Value::as_str)
            .unwrap_or(&entry.path)
            .to_string();
        let is_grpc = before.as_ref().and_then(|v| v.get("kind")).and_then(Value::as_str) == Some("grpc")
            || after.as_ref().and_then(|v| v.get("kind")).and_then(Value::as_str) == Some("grpc");

        if is_grpc {
            let breaking = entry.status == "removed";
            results.push(DiffEntryResult {
                path: entry.path.clone(),
                status: entry.status.clone(),
                method: "gRPC".to_string(),
                url: name,
                changes: vec![],
                breaking,
                reasons: if breaking { vec!["This gRPC request was deleted — clients still calling it will fail.".to_string()] } else { vec![] },
            });
            continue;
        }

        let before_req = before.as_ref().and_then(|v| v.get("request")).cloned();
        let after_req = after.as_ref().and_then(|v| v.get("request")).cloned();

        let (changes, mut breaking, mut reasons) = match (&before_req, &after_req) {
            (Some(b), Some(a)) => diff_request(b, a),
            _ => (vec![], false, vec![]),
        };
        if entry.status == "removed" {
            breaking = true;
            reasons = vec!["This request was deleted — apps still calling it will get a \"not found\" error.".to_string()];
        } else if entry.status == "added" {
            breaking = false;
            reasons.clear();
        }

        let method = after_req
            .as_ref()
            .or(before_req.as_ref())
            .and_then(|r| r.get("method"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let url = after_req.as_ref().or(before_req.as_ref()).and_then(|r| r.get("url")).and_then(Value::as_str).unwrap_or("").to_string();

        results.push(DiffEntryResult { path: entry.path.clone(), status: entry.status.clone(), method, url, changes, breaking, reasons });
    }
    results
}

fn print_diff_pretty(results: &[DiffEntryResult]) {
    let color = std::io::stdout().is_terminal();
    let (bold, dim, reset) = if color { (ANSI_BOLD, ANSI_DIM, ANSI_RESET) } else { ("", "", "") };
    println!("{bold}Relay Diff{reset}\n");
    for r in results {
        let marker = match r.status.as_str() {
            "added" => "+",
            "removed" => "-",
            _ => "~",
        };
        let (mc, mr) = if color {
            (
                match r.status.as_str() {
                    "added" => ANSI_GREEN,
                    "removed" => ANSI_RED,
                    _ => ANSI_YELLOW,
                },
                reset,
            )
        } else {
            ("", "")
        };
        println!("{mc}{marker} {} {}{mr}", r.method, r.url);
        for c in &r.changes {
            println!("    {dim}{c}{reset}");
        }
        if r.breaking {
            let (rc, rr) = if color { (ANSI_RED, reset) } else { ("", "") };
            for reason in &r.reasons {
                println!("    {rc}⚠ {reason}{rr}");
            }
        }
        println!();
    }
    let breaking_count = results.iter().filter(|r| r.breaking).count();
    let (c, r) = if color {
        (if breaking_count > 0 { ANSI_RED } else { ANSI_GREEN }, reset)
    } else {
        ("", "")
    };
    println!("{c}{breaking_count} breaking change{}{r}", if breaking_count == 1 { "" } else { "s" });
}

fn print_diff_ci(results: &[DiffEntryResult]) {
    for r in results {
        println!("[{}] {} {}{}", r.status.to_uppercase(), r.method, r.url, if r.breaking { " (breaking)" } else { "" });
        for c in &r.changes {
            println!("    {c}");
        }
        for reason in &r.reasons {
            println!("    ! {reason}");
        }
    }
}

fn cmd_diff(args: &[String]) -> ExitCode {
    if args.len() < 2 {
        print_usage();
        return ExitCode::FAILURE;
    }
    let dir = args[0].clone();
    let base = args[1].clone();
    let mut idx = 2;
    let mut compare: Option<String> = None;
    if let Some(next) = args.get(idx) {
        if !next.starts_with("--") {
            compare = Some(next.clone());
            idx += 1;
        }
    }
    let mut ci = false;
    let mut json_output = false;
    while idx < args.len() {
        match args[idx].as_str() {
            "--ci" => ci = true,
            "--json" => json_output = true,
            other => {
                eprintln!("Unknown argument: {other}");
                print_usage();
                return ExitCode::FAILURE;
            }
        }
        idx += 1;
    }

    let entries = match git_branch_diff(dir.clone(), base, compare, false) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Diff failed: {e}");
            return ExitCode::FAILURE;
        }
    };

    let results = build_diffs(&entries);
    let any_breaking = results.iter().any(|r| r.breaking);

    if json_output {
        println!("{}", serde_json::to_string_pretty(&results).unwrap_or_default());
    } else if ci {
        print_diff_ci(&results);
    } else if results.is_empty() {
        println!("No API changes between these refs.");
    } else {
        print_diff_pretty(&results);
    }

    if any_breaking {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("--version") | Some("-v") | Some("version") => {
            print_version();
            return ExitCode::SUCCESS;
        }
        Some("--help") | Some("-h") | Some("help") | None => {
            print_usage();
            return if args.len() > 1 { ExitCode::SUCCESS } else { ExitCode::FAILURE };
        }
        Some("check") => return cmd_check(&args[2..]),
        Some("diff") => return cmd_diff(&args[2..]),
        Some("run") => {}
        Some(other) => {
            eprintln!("Unknown command: {other}");
            print_usage();
            return ExitCode::FAILURE;
        }
    }
    if args.len() < 4 {
        print_usage();
        return ExitCode::FAILURE;
    }
    let dir = args[2].clone();
    let needle = args[3].to_lowercase();
    let mut env_name: Option<String> = None;
    let mut json_output = false;
    let mut i = 4;
    while i < args.len() {
        match args[i].as_str() {
            "--env" => {
                i += 1;
                env_name = args.get(i).cloned();
            }
            "--json" => json_output = true,
            other => {
                eprintln!("Unknown argument: {other}");
                print_usage();
                return ExitCode::FAILURE;
            }
        }
        i += 1;
    }

    let raw = match load_workspace_dir(dir.clone()) {
        Ok(raw) => raw,
        Err(e) => {
            eprintln!("Failed to load workspace at \"{dir}\": {e}");
            return ExitCode::FAILURE;
        }
    };
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Failed to parse workspace data: {e}");
            return ExitCode::FAILURE;
        }
    };
    let Some(workspace) = parsed.get("workspace").filter(|w| !w.is_null()) else {
        eprintln!("No Relay workspace found in \"{dir}\".");
        return ExitCode::FAILURE;
    };

    let mut vars: HashMap<String, String> = HashMap::new();
    if let Some(rows) = workspace.get("variables").and_then(Value::as_array) {
        kvrows_into_map(rows, &mut vars);
    }
    if let Some(name) = &env_name {
        let envs = workspace.get("environments").and_then(Value::as_array).cloned().unwrap_or_default();
        match envs.iter().find(|e| e.get("name").and_then(Value::as_str) == Some(name.as_str())) {
            Some(env) => {
                if let Some(rows) = env.get("variables").and_then(Value::as_array) {
                    kvrows_into_map(rows, &mut vars);
                }
            }
            None => {
                eprintln!("No environment named \"{name}\" in this workspace.");
                return ExitCode::FAILURE;
            }
        }
    }

    let tree = workspace.get("tree").and_then(Value::as_array).cloned().unwrap_or_default();
    let Some((matched_name, request)) = find_request(&tree, &needle) else {
        eprintln!("No HTTP request matching \"{}\" found in this workspace.", args[3]);
        return ExitCode::FAILURE;
    };

    let method = request.get("method").and_then(Value::as_str).unwrap_or("GET").to_string();
    let raw_url = request.get("url").and_then(Value::as_str).unwrap_or("");
    let url = substitute_vars(raw_url, &vars);

    let mut headers: Vec<(String, String)> = Vec::new();
    if let Some(rows) = request.get("headers").and_then(Value::as_array) {
        for row in rows {
            let enabled = row.get("enabled").and_then(Value::as_bool).unwrap_or(true);
            let key = row.get("key").and_then(Value::as_str).unwrap_or("").trim().to_string();
            if !enabled || key.is_empty() {
                continue;
            }
            let value = substitute_vars(row.get("value").and_then(Value::as_str).unwrap_or(""), &vars);
            headers.push((key, value));
        }
    }

    let body_mode = request.get("bodyMode").and_then(Value::as_str).unwrap_or("none");
    let body = match body_mode {
        "json" | "text" => {
            let raw_body = request.get("bodyText").and_then(Value::as_str).unwrap_or("");
            Some(substitute_vars(raw_body, &vars))
        }
        "none" => None,
        other => {
            eprintln!("Note: bodyMode \"{other}\" (form-data/urlencoded) isn't supported by relay-cli yet — sending with no body.");
            None
        }
    };
    if request.get("auth").and_then(|a| a.get("type")).and_then(Value::as_str).is_some_and(|t| t != "none") {
        eprintln!("Note: this request has an Auth tab configured — relay-cli v1 doesn't apply it yet, sending without it.");
    }
    if !request.get("preScript").and_then(Value::as_str).unwrap_or("").trim().is_empty()
        || !request.get("testScript").and_then(Value::as_str).unwrap_or("").trim().is_empty()
    {
        eprintln!("Note: pre-request/test scripts aren't run by relay-cli v1 — skipped.");
    }

    eprintln!("→ {method} {url} ({matched_name})");

    let payload = HttpRequestPayload {
        method,
        url,
        headers,
        body,
        form_data: None,
        timeout_ms: None,
        follow_redirects: true,
        max_redirects: None,
    };

    match http_request(payload).await {
        Ok(resp) => {
            if json_output {
                println!("{}", serde_json::to_string_pretty(&resp).unwrap_or_default());
            } else {
                println!("{} {} — {}ms, {} bytes", resp.status, resp.status_text, resp.time_ms, resp.size_bytes);
                println!("{}", resp.body);
            }
            if resp.ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(e) => {
            eprintln!("Request failed: {e}");
            ExitCode::FAILURE
        }
    }
}
