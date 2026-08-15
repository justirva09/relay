use std::fs;
use tauri::{AppHandle, Manager};

use crate::grpc::ProtoFileInput;

fn workspace_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("workspace.json"))
}

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

/// Recursively reads every `.proto` file under the given root directory, keyed by
/// its path relative to that root — matching `import "pkg/sub/file.proto";`
/// statements exactly, the same way `protoc -I <root>` resolves imports, instead
/// of requiring the user to hunt down and attach each dependency by hand.
#[tauri::command]
pub fn list_proto_files_in_dir(dir: String) -> Result<Vec<ProtoFileInput>, String> {
    let root = std::path::Path::new(&dir);
    let mut out = Vec::new();
    walk_proto_files(root, root, &mut out)?;
    Ok(out)
}
