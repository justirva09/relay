use std::path::Path;
use std::process::Command;
use serde::Serialize;

#[derive(Serialize)]
pub struct GitFileChange {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct GitStatusInfo {
    pub branch: String,
    pub files: Vec<GitFileChange>,
}

fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn status_label(code: &str) -> String {
    if code == "??" {
        return "U".to_string();
    }
    let bytes = code.as_bytes();
    let marker = if bytes.len() == 2 && bytes[1] != b' ' { bytes[1] } else { bytes[0] };
    match marker {
        b'A' => "A".to_string(),
        b'D' => "D".to_string(),
        b'R' => "R".to_string(),
        b'M' => "M".to_string(),
        _ => "M".to_string(),
    }
}

/// Returns None when `dir` isn't inside a git work tree (or `git` isn't
/// installed) so the frontend can silently hide the Source Control panel
/// instead of showing an error for the common case of a non-git workspace.
#[tauri::command]
pub fn git_status(dir: String) -> Result<Option<GitStatusInfo>, String> {
    let path = Path::new(&dir);
    if run_git(path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(None);
    }

    // symbolic-ref resolves the branch name even before the first commit
    // exists (an "unborn" branch), unlike rev-parse --abbrev-ref.
    let branch = match run_git(path, &["symbolic-ref", "--short", "-q", "HEAD"]) {
        Ok(name) if !name.is_empty() => name,
        _ => run_git(path, &["rev-parse", "--short", "HEAD"]).unwrap_or_else(|_| "no commits yet".to_string()),
    };

    let raw = run_git(path, &["status", "--porcelain", "--", "."])?;
    let files = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let code = &line[..2.min(line.len())];
            let file_path = line.get(3..).unwrap_or("").to_string();
            GitFileChange { path: file_path, status: status_label(code) }
        })
        .collect();

    Ok(Some(GitStatusInfo { branch, files }))
}

#[tauri::command]
pub fn git_commit(dir: String, message: String) -> Result<(), String> {
    let path = Path::new(&dir);
    if message.trim().is_empty() {
        return Err("Commit message is required".to_string());
    }
    run_git(path, &["add", "-A", "."])?;
    run_git(path, &["commit", "-m", message.trim()])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("relay-git-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Command::new("git").arg("init").arg("-q").arg("-b").arg("main").current_dir(&dir).output().unwrap();
        Command::new("git").args(["config", "user.email", "test@example.com"]).current_dir(&dir).output().unwrap();
        Command::new("git").args(["config", "user.name", "Test"]).current_dir(&dir).output().unwrap();
        dir
    }

    #[test]
    fn non_git_dir_returns_none() {
        let dir = std::env::temp_dir().join("relay-git-test-not-a-repo");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let result = git_status(dir.to_string_lossy().to_string()).unwrap();
        assert!(result.is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_branch_and_untracked_file() {
        let dir = tmp_repo("status");
        fs::write(dir.join("a.relay"), "{}").unwrap();
        let info = git_status(dir.to_string_lossy().to_string()).unwrap().expect("should be a repo");
        assert_eq!(info.branch, "main");
        assert_eq!(info.files.len(), 1);
        assert_eq!(info.files[0].path, "a.relay");
        assert_eq!(info.files[0].status, "U");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_stages_and_commits_changes() {
        let dir = tmp_repo("commit");
        fs::write(dir.join("a.relay"), "{}").unwrap();
        git_commit(dir.to_string_lossy().to_string(), "initial commit".to_string()).expect("commit failed");

        let info = git_status(dir.to_string_lossy().to_string()).unwrap().unwrap();
        assert_eq!(info.files.len(), 0, "working tree should be clean after commit");

        let err = git_commit(dir.to_string_lossy().to_string(), "nothing to commit".to_string());
        assert!(err.is_err(), "committing with no changes should fail");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_requires_a_message() {
        let dir = tmp_repo("empty-message");
        let err = git_commit(dir.to_string_lossy().to_string(), "  ".to_string());
        assert!(err.is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
