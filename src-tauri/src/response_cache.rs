// Local-only cache of each request's last response, keyed by workspace
// folder. Deliberately NOT part of the .relay files — response bodies and
// timestamps change on every send, which would turn the git-native
// collection files this app is built around into noisy, unreviewable diffs.
// Lives in the app's own data dir instead, and is never committed.
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use tauri::{AppHandle, Manager};

fn cache_path(app: &AppHandle, workspace_dir: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = dir.join("response-cache");
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let mut hasher = DefaultHasher::new();
    workspace_dir.hash(&mut hasher);
    Ok(cache_dir.join(format!("{:x}.json", hasher.finish())))
}

#[tauri::command]
pub fn load_response_cache(app: AppHandle, workspace_dir: String) -> Result<String, String> {
    let path = cache_path(&app, &workspace_dir)?;
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_response_cache(app: AppHandle, workspace_dir: String, data: String) -> Result<(), String> {
    let path = cache_path(&app, &workspace_dir)?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn different_workspace_dirs_hash_to_different_files() {
        let dir = std::env::temp_dir().join("relay-response-cache-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut h1 = DefaultHasher::new();
        "/Users/a/workspace-one".hash(&mut h1);
        let mut h2 = DefaultHasher::new();
        "/Users/a/workspace-two".hash(&mut h2);
        assert_ne!(h1.finish(), h2.finish());

        fs::remove_dir_all(&dir).ok();
    }
}
