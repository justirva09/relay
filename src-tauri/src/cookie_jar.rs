// Local-only cookie jar, keyed by workspace folder — same reasoning as
// response_cache.rs: cookies are session state, not something a shared/
// versioned collection should carry (neither Postman nor Bruno commit
// cookies into their collection files either — both keep the jar in local
// app storage). Lives in the app's own data dir, never touches .relay.
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use tauri::{AppHandle, Manager};

fn jar_path(app: &AppHandle, workspace_dir: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let jar_dir = dir.join("cookie-jar");
    fs::create_dir_all(&jar_dir).map_err(|e| e.to_string())?;
    let mut hasher = DefaultHasher::new();
    workspace_dir.hash(&mut hasher);
    Ok(jar_dir.join(format!("{:x}.json", hasher.finish())))
}

#[tauri::command]
pub fn load_cookie_jar(app: AppHandle, workspace_dir: String) -> Result<String, String> {
    let path = jar_path(&app, &workspace_dir)?;
    if !path.exists() {
        return Ok("[]".to_string());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_cookie_jar(app: AppHandle, workspace_dir: String, data: String) -> Result<(), String> {
    let path = jar_path(&app, &workspace_dir)?;
    fs::write(path, data).map_err(|e| e.to_string())
}
