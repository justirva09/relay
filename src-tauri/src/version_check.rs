use serde::{Deserialize, Serialize};
use std::time::Duration;

const VERSION_STATUS_URL: &str = "https://relay-landing-page-iota.vercel.app/version-status.json";

#[derive(Deserialize)]
struct RemoteVersionStatus {
    #[serde(default)]
    blocked: bool,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Serialize)]
pub struct VersionStatus {
    pub blocked: bool,
    pub message: String,
}

/// Fetches a remote kill-switch flag so a build can be disabled remotely.
/// Any failure (offline, bad JSON) errors out rather than guessing, so the
/// frontend fails open explicitly instead of silently.
#[tauri::command]
pub async fn check_version_status() -> Result<VersionStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(VERSION_STATUS_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("unexpected status {}", res.status()));
    }

    let parsed: RemoteVersionStatus = res.json().await.map_err(|e| e.to_string())?;
    Ok(VersionStatus {
        blocked: parsed.blocked,
        message: parsed
            .message
            .unwrap_or_else(|| "This build is no longer supported. Please download the latest version.".to_string()),
    })
}
