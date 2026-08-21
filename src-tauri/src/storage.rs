use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::grpc::ProtoFileInput;

fn workspace_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("workspace.json"))
}

/// Legacy single-file store from before .relay folders. Kept so the
/// frontend can migrate old data once; not used for ongoing storage.
#[tauri::command]
pub fn load_workspace(app: AppHandle) -> Result<String, String> {
    let path = workspace_path(&app)?;
    if !path.exists() {
        return Ok("null".to_string());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_workspace(app: AppHandle, data: String) -> Result<(), String> {
    let path = workspace_path(&app)?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file_at_path(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
pub fn write_file_at_path(path: String, data: String) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| format!("Failed to write {}: {}", path, e))
}

fn walk_proto_files(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<ProtoFileInput>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            walk_proto_files(root, &entry_path, out)?;
            continue;
        }
        if entry_path.extension().and_then(|e| e.to_str()) != Some("proto") {
            continue;
        }
        let relative = entry_path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let content = fs::read_to_string(&entry_path)
            .map_err(|e| format!("Failed to read {}: {}", entry_path.display(), e))?;
        out.push(ProtoFileInput { name: relative, content });
    }
    Ok(())
}

/// Recursively reads every .proto file under root, keyed by its relative
/// path, matching import statements the same way `protoc -I` resolves them.
#[tauri::command]
pub fn list_proto_files_in_dir(dir: String) -> Result<Vec<ProtoFileInput>, String> {
    let root = std::path::Path::new(&dir);
    let mut out = Vec::new();
    walk_proto_files(root, root, &mut out)?;
    Ok(out)
}

// Git-native workspace storage (.relay): one deterministic JSON file per
// request/folder/environment instead of one big blob. Stable slugs and
// sorted keys keep untouched nodes byte-identical across saves, so git
// diffs only show what actually changed.

fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_slug(used: &mut HashMap<String, String>, base: &str, id: &str) -> String {
    if used.get(base).map(|v| v.as_str()) == Some(id) {
        return base.to_string();
    }
    if !used.contains_key(base) {
        used.insert(base.to_string(), id.to_string());
        return base.to_string();
    }
    let short_id: String = id.chars().take(6).collect();
    let mut candidate = format!("{}-{}", base, short_id);
    let mut n = 2;
    while used.contains_key(&candidate) {
        candidate = format!("{}-{}-{}", base, short_id, n);
        n += 1;
    }
    used.insert(candidate.clone(), id.to_string());
    candidate
}

fn node_id(node: &Value) -> String {
    node.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn node_name(node: &Value) -> String {
    node.get("name").and_then(|v| v.as_str()).unwrap_or("Untitled").to_string()
}

/// Writes nodes as children of dir, returning ordered "kind:slug" refs used to reconstruct order.
fn write_tree_nodes(dir: &Path, nodes: &[Value], reserved_dirs: &[&str], reserved_files: &[&str]) -> Result<Vec<String>, String> {
    let mut used_dirs: HashMap<String, String> = HashMap::new();
    let mut used_files: HashMap<String, String> = HashMap::new();
    for r in reserved_dirs {
        used_dirs.insert(r.to_string(), String::new());
    }
    for r in reserved_files {
        used_files.insert(r.to_string(), String::new());
    }

    let mut order = Vec::new();
    for node in nodes {
        let kind = node.get("kind").and_then(|v| v.as_str()).unwrap_or("request").to_string();
        let id = node_id(node);
        let base = slugify(&node_name(node));

        if kind == "folder" {
            let slug = unique_slug(&mut used_dirs, &base, &id);
            let folder_dir = dir.join(&slug);
            fs::create_dir_all(&folder_dir).map_err(|e| e.to_string())?;
            let children = node.get("children").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let child_order = write_tree_nodes(&folder_dir, &children, &[], &["_folder"])?;
            let meta = json!({
                "id": id,
                "name": node_name(node),
                "collapsed": node.get("collapsed").cloned().unwrap_or(Value::Null),
                "order": child_order,
            });
            fs::write(folder_dir.join("_folder.relay"), serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            order.push(format!("folder:{}", slug));
        } else {
            let slug = unique_slug(&mut used_files, &base, &id);
            fs::write(
                dir.join(format!("{}.relay", slug)),
                serde_json::to_string_pretty(node).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            order.push(format!("{}:{}", kind, slug));
        }
    }
    Ok(order)
}

fn read_tree_nodes(dir: &Path, order: &[Value]) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for entry in order {
        let entry = entry.as_str().unwrap_or("");
        let Some((kind, slug)) = entry.split_once(':') else { continue };
        if kind == "folder" {
            let folder_dir = dir.join(slug);
            let meta_path = folder_dir.join("_folder.relay");
            if !meta_path.exists() {
                continue;
            }
            let meta_raw = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
            let meta: Value = serde_json::from_str(&meta_raw).map_err(|e| e.to_string())?;
            let child_order = meta.get("order").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let children = read_tree_nodes(&folder_dir, &child_order)?;
            out.push(json!({
                "id": meta.get("id").cloned().unwrap_or(Value::Null),
                "kind": "folder",
                "name": meta.get("name").cloned().unwrap_or(Value::String("Untitled".to_string())),
                "collapsed": meta.get("collapsed").cloned().unwrap_or(Value::Null),
                "children": children,
            }));
        } else {
            let file_path = dir.join(format!("{}.relay", slug));
            if !file_path.exists() {
                continue;
            }
            let raw = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
            let node: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            out.push(node);
        }
    }
    Ok(out)
}

fn ensure_gitignored(root: &Path, pattern: &str) -> Result<(), String> {
    let path = root.join(".gitignore");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }
    let mut updated = existing;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(pattern);
    updated.push('\n');
    fs::write(path, updated).map_err(|e| e.to_string())
}

fn clean_workspace_dir(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Detects whether a workspace at dir is flat or hidden (.relay/), based on
/// which workspace.relay exists on disk. Matches whatever a cloned folder was already using.
fn detect_layout(dir: &str) -> Option<bool> {
    if Path::new(dir).join(".relay").join("workspace.relay").exists() {
        Some(true)
    } else if Path::new(dir).join("workspace.relay").exists() {
        Some(false)
    } else {
        None
    }
}

/// True if dir has anything besides dotfiles, meaning it's an existing
/// project folder. Lets the frontend force hidden layout instead of flat
/// mode wiping other files.
#[tauri::command]
pub fn dir_has_other_files(dir: String) -> Result<bool, String> {
    let path = Path::new(&dir);
    if !path.exists() {
        return Ok(false);
    }
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_name().to_string_lossy().starts_with('.') {
            return Ok(true);
        }
    }
    Ok(false)
}

fn relay_root(dir: &str, hidden: bool) -> std::path::PathBuf {
    let hidden = detect_layout(dir).unwrap_or(hidden);
    if hidden {
        Path::new(dir).join(".relay")
    } else {
        Path::new(dir).to_path_buf()
    }
}

#[tauri::command]
pub fn save_workspace_dir(dir: String, data: String, hidden: bool) -> Result<(), String> {
    let root_buf = relay_root(&dir, hidden);
    let root = root_buf.as_path();
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let ws: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    clean_workspace_dir(root)?;

    let tree = ws.get("tree").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let root_order = write_tree_nodes(root, &tree, &["environments"], &["workspace"])?;

    let environments = ws.get("environments").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let env_dir = root.join("environments");
    fs::create_dir_all(&env_dir).map_err(|e| e.to_string())?;
    let mut used_env: HashMap<String, String> = HashMap::new();
    let mut env_order = Vec::new();
    let mut has_secret = false;
    for env in &environments {
        let id = node_id(env);
        let base = slugify(&node_name(env));
        let slug = unique_slug(&mut used_env, &base, &id);

        let mut public_env = env.clone();
        let mut secrets = serde_json::Map::new();
        if let Some(rows) = public_env.get_mut("variables").and_then(|v| v.as_array_mut()) {
            for row in rows.iter_mut() {
                if row.get("secret").and_then(|v| v.as_bool()) != Some(true) {
                    continue;
                }
                let row_id = row.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if let Some(value) = row.get("value").cloned() {
                    secrets.insert(row_id, value);
                }
                row["value"] = json!("");
            }
        }

        fs::write(
            env_dir.join(format!("{}.relay", slug)),
            serde_json::to_string_pretty(&public_env).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

        if !secrets.is_empty() {
            has_secret = true;
            fs::write(
                env_dir.join(format!("{}.secret.relay", slug)),
                serde_json::to_string_pretty(&Value::Object(secrets)).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }

        env_order.push(slug);
    }

    if has_secret {
        ensure_gitignored(root, "*.secret.relay")?;
    }

    let root_meta = json!({
        "name": ws.get("name").cloned().unwrap_or(json!("Untitled Workspace")),
        "variables": ws.get("variables").cloned().unwrap_or(json!([])),
        "activeEnvironmentId": ws.get("activeEnvironmentId").cloned().unwrap_or(Value::Null),
        "protoLibrary": ws.get("protoLibrary").cloned().unwrap_or(json!([])),
        "order": root_order,
        "environmentOrder": env_order,
    });
    fs::write(
        root.join("workspace.relay"),
        serde_json::to_string_pretty(&root_meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn load_workspace_dir(dir: String) -> Result<String, String> {
    let Some(hidden) = detect_layout(&dir) else {
        return serde_json::to_string(&json!({ "workspace": null, "hidden": false })).map_err(|e| e.to_string());
    };
    let root_buf = relay_root(&dir, hidden);
    let root = root_buf.as_path();
    let meta_path = root.join("workspace.relay");
    let meta_raw = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let meta: Value = serde_json::from_str(&meta_raw).map_err(|e| e.to_string())?;

    let root_order = meta.get("order").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let tree = read_tree_nodes(root, &root_order)?;

    let env_order = meta.get("environmentOrder").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let env_dir = root.join("environments");
    let mut environments = Vec::new();
    for slug in &env_order {
        let slug = slug.as_str().unwrap_or("");
        let path = env_dir.join(format!("{}.relay", slug));
        if !path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut env: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

        let secret_path = env_dir.join(format!("{}.secret.relay", slug));
        if secret_path.exists() {
            let secret_raw = fs::read_to_string(&secret_path).map_err(|e| e.to_string())?;
            let secrets: Value = serde_json::from_str(&secret_raw).map_err(|e| e.to_string())?;
            if let Some(rows) = env.get_mut("variables").and_then(|v| v.as_array_mut()) {
                for row in rows.iter_mut() {
                    let row_id = row.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if let Some(value) = secrets.get(&row_id) {
                        row["value"] = value.clone();
                    }
                }
            }
        }

        environments.push(env);
    }

    let workspace = json!({
        "name": meta.get("name").cloned().unwrap_or(json!("Untitled Workspace")),
        "tree": tree,
        "variables": meta.get("variables").cloned().unwrap_or(json!([])),
        "environments": environments,
        "activeEnvironmentId": meta.get("activeEnvironmentId").cloned().unwrap_or(Value::Null),
        "protoLibrary": meta.get("protoLibrary").cloned().unwrap_or(json!([])),
    });

    serde_json::to_string(&json!({ "workspace": workspace, "hidden": hidden })).map_err(|e| e.to_string())
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("relay-config.json"))
}

#[tauri::command]
pub fn get_last_workspace_dir(app: AppHandle) -> Result<Option<String>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let cfg: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(cfg.get("workspaceDir").and_then(|v| v.as_str()).map(|s| s.to_string()))
}

#[tauri::command]
pub fn set_last_workspace_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let cfg = json!({ "workspaceDir": dir });
    fs::write(path, serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("relay-storage-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn round_trips_tree_environments_and_variables() {
        let dir = tmp_dir("roundtrip");
        let ws = json!({
            "name": "Acme API",
            "tree": [
                {
                    "id": "f1",
                    "kind": "folder",
                    "name": "GitHub API",
                    "collapsed": false,
                    "children": [
                        {
                            "id": "r1",
                            "kind": "request",
                            "name": "Get user",
                            "request": { "method": "GET", "url": "https://api.github.com/users/x", "params": [], "headers": [], "bodyMode": "none", "bodyText": "", "preScript": "", "testScript": "" }
                        },
                        {
                            "id": "g1",
                            "kind": "grpc",
                            "name": "SayHello",
                            "request": { "url": "grpc://localhost", "service": "Greeter", "method": "SayHello", "methodType": "unary", "messageJson": "{}", "metadata": [], "protoSource": "reflection" }
                        }
                    ]
                }
            ],
            "variables": [{ "id": "v1", "key": "base", "value": "1", "enabled": true }],
            "environments": [
                { "id": "e1", "name": "Production", "variables": [{ "id": "v2", "key": "host", "value": "prod", "enabled": true }] }
            ],
            "activeEnvironmentId": "e1",
            "protoLibrary": []
        });

        save_workspace_dir(dir.to_string_lossy().to_string(), ws.to_string(), true).expect("save failed");

        let relay = dir.join(".relay");
        assert!(relay.join("workspace.relay").exists());
        assert!(relay.join("github-api").join("_folder.relay").exists());
        assert!(relay.join("github-api").join("get-user.relay").exists());
        assert!(relay.join("github-api").join("sayhello.relay").exists());
        assert!(relay.join("environments").join("production.relay").exists());

        let raw = load_workspace_dir(dir.to_string_lossy().to_string()).expect("load failed");
        let envelope: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(envelope["hidden"], true);
        let loaded = &envelope["workspace"];
        assert_eq!(loaded["name"], "Acme API");
        assert_eq!(loaded["tree"][0]["name"], "GitHub API");
        assert_eq!(loaded["tree"][0]["children"][0]["name"], "Get user");
        assert_eq!(loaded["tree"][0]["children"][1]["request"]["service"], "Greeter");
        assert_eq!(loaded["environments"][0]["name"], "Production");
        assert_eq!(loaded["activeEnvironmentId"], "e1");
        assert_eq!(loaded["variables"][0]["key"], "base");

        // Rename and re-save: old file gone, new one present, untouched siblings stay byte-identical.
        let before_grpc = fs::read_to_string(relay.join("github-api").join("sayhello.relay")).unwrap();
        let mut ws2 = loaded.clone();
        ws2["tree"][0]["children"][0]["name"] = json!("Fetch user");
        // hidden=false here is ignored, layout was already set to hidden by the first save.
        save_workspace_dir(dir.to_string_lossy().to_string(), ws2.to_string(), false).expect("save2 failed");
        assert!(!relay.join("github-api").join("get-user.relay").exists());
        assert!(relay.join("github-api").join("fetch-user.relay").exists());
        let after_grpc = fs::read_to_string(relay.join("github-api").join("sayhello.relay")).unwrap();
        assert_eq!(before_grpc, after_grpc, "untouched node must be byte-identical across saves");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn same_name_folder_and_request_do_not_collide() {
        let dir = tmp_dir("collision");
        let ws = json!({
            "tree": [
                { "id": "folder-1", "kind": "folder", "name": "Reports", "children": [] },
                { "id": "req-1", "kind": "request", "name": "Reports", "request": { "method": "GET", "url": "", "params": [], "headers": [], "bodyMode": "none", "bodyText": "", "preScript": "", "testScript": "" } }
            ],
            "variables": [],
            "environments": [],
            "activeEnvironmentId": null,
            "protoLibrary": []
        });
        save_workspace_dir(dir.to_string_lossy().to_string(), ws.to_string(), true).expect("save failed");
        assert!(dir.join(".relay").join("reports").is_dir());
        assert!(dir.join(".relay").join("reports.relay").is_file());

        let raw = load_workspace_dir(dir.to_string_lossy().to_string()).expect("load failed");
        let envelope: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(envelope["workspace"]["tree"].as_array().unwrap().len(), 2);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hidden_mode_never_touches_other_files_in_the_chosen_folder() {
        let dir = tmp_dir("existing-project");
        // User points Relay at an existing project folder that already has its own files.
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("package.json"), "{\"name\":\"my-app\"}").unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src").join("index.js"), "console.log('hi')").unwrap();

        let ws = json!({
            "tree": [{ "id": "r1", "kind": "request", "name": "Ping", "request": { "method": "GET", "url": "", "params": [], "headers": [], "bodyMode": "none", "bodyText": "", "preScript": "", "testScript": "" } }],
            "variables": [], "environments": [], "activeEnvironmentId": null, "protoLibrary": []
        });
        save_workspace_dir(dir.to_string_lossy().to_string(), ws.to_string(), true).expect("save failed");

        assert_eq!(fs::read_to_string(dir.join("package.json")).unwrap(), "{\"name\":\"my-app\"}");
        assert_eq!(fs::read_to_string(dir.join("src").join("index.js")).unwrap(), "console.log('hi')");
        assert!(dir.join(".relay").join("ping.relay").exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn flat_mode_writes_directly_to_the_chosen_folder() {
        let dir = tmp_dir("flat");
        let ws = json!({
            "tree": [{ "id": "r1", "kind": "request", "name": "Ping", "request": { "method": "GET", "url": "", "params": [], "headers": [], "bodyMode": "none", "bodyText": "", "preScript": "", "testScript": "" } }],
            "variables": [], "environments": [], "activeEnvironmentId": null, "protoLibrary": []
        });
        save_workspace_dir(dir.to_string_lossy().to_string(), ws.to_string(), false).expect("save failed");

        assert!(dir.join("workspace.relay").exists());
        assert!(dir.join("ping.relay").exists());
        assert!(!dir.join(".relay").exists(), "flat mode shouldn't create a .relay subfolder at all");

        let raw = load_workspace_dir(dir.to_string_lossy().to_string()).expect("load failed");
        let envelope: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(envelope["hidden"], false);
        assert_eq!(envelope["workspace"]["tree"][0]["name"], "Ping");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dir_has_other_files_ignores_dotfiles() {
        let dir = tmp_dir("emptiness-check");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(dir_has_other_files(dir.to_string_lossy().to_string()).unwrap(), false);

        fs::write(dir.join(".gitignore"), "").unwrap();
        assert_eq!(dir_has_other_files(dir.to_string_lossy().to_string()).unwrap(), false, "dotfiles don't count as other content");

        fs::write(dir.join("README.md"), "").unwrap();
        assert_eq!(dir_has_other_files(dir.to_string_lossy().to_string()).unwrap(), true);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn secret_env_values_are_split_into_gitignored_file() {
        let dir = tmp_dir("secret");
        let ws = json!({
            "tree": [],
            "variables": [],
            "environments": [
                {
                    "id": "e1",
                    "name": "Production",
                    "variables": [
                        { "id": "v1", "key": "host", "value": "api.example.com", "enabled": true, "secret": false },
                        { "id": "v2", "key": "api_key", "value": "sk-supersecret", "enabled": true, "secret": true }
                    ]
                }
            ],
            "activeEnvironmentId": "e1",
            "protoLibrary": []
        });

        save_workspace_dir(dir.to_string_lossy().to_string(), ws.to_string(), true).expect("save failed");

        let env_dir = dir.join(".relay").join("environments");
        assert!(env_dir.join("production.relay").exists());
        assert!(env_dir.join("production.secret.relay").exists());

        let plain_raw = fs::read_to_string(env_dir.join("production.relay")).unwrap();
        assert!(!plain_raw.contains("sk-supersecret"), "secret value must not land in the committed file");
        assert!(plain_raw.contains("api.example.com"), "non-secret value stays in the committed file");

        // Lives inside .relay/, not the project root's .gitignore. Git honors
        // nested .gitignore files, so saving never touches anything outside .relay/.
        let gitignore = fs::read_to_string(dir.join(".relay").join(".gitignore")).unwrap();
        assert!(gitignore.contains("*.secret.relay"));

        let raw = load_workspace_dir(dir.to_string_lossy().to_string()).expect("load failed");
        let envelope: Value = serde_json::from_str(&raw).unwrap();
        let loaded = &envelope["workspace"];
        let vars = loaded["environments"][0]["variables"].as_array().unwrap();
        let api_key = vars.iter().find(|v| v["key"] == "api_key").unwrap();
        assert_eq!(api_key["value"], "sk-supersecret", "secret value must merge back on load");
        let host = vars.iter().find(|v| v["key"] == "host").unwrap();
        assert_eq!(host["value"], "api.example.com");

        fs::remove_dir_all(&dir).ok();
    }
}
