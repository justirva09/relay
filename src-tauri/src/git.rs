use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Serialize;
use serde_json::Value;

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

#[derive(Serialize)]
pub struct ApiHistoryEntry {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub content: Option<String>,
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
    // trim_end only — `git status --porcelain`'s fixed-column format uses a
    // LEADING space to mean "unstaged-only change" (e.g. " M path"); a plain
    // .trim() would eat that space whenever it's the first character of the
    // whole output (a single such file with nothing before it), silently
    // shifting every subsequent fixed-offset substring read by one char and
    // truncating the path's first character.
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

/// Mirrors storage::detect_layout — whether this workspace's files live
/// under a hidden `.relay/` subfolder or flat in `dir` itself, so the
/// Source Control panel only ever touches what's actually the workspace
/// (never unrelated files elsewhere in the same repo, in hidden mode).
fn relay_pathspec(dir: &str) -> &'static str {
    if Path::new(dir).join(".relay").join("workspace.relay").exists() {
        ".relay"
    } else {
        "."
    }
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

    // In hidden mode, scope to .relay/ only — `dir` is the folder the user
    // picked, which is very likely an existing project's repo, and its
    // unrelated files should never show up as "changes" here. In flat mode
    // the whole folder legitimately is the workspace, so "." is correct.
    // --untracked-files=all: without it, a wholly-untracked .relay/ directory
    // collapses to a single "?? .relay/" line instead of listing each file.
    let pathspec = relay_pathspec(&dir);
    let raw = run_git(path, &["status", "--porcelain", "--untracked-files=all", "--", pathspec])?;
    let prefix = format!("{}/", pathspec);
    let files = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let code = &line[..2.min(line.len())];
            let file_path = line.get(3..).unwrap_or("");
            let file_path = file_path.strip_prefix(prefix.as_str()).unwrap_or(file_path).to_string();
            GitFileChange { path: file_path, status: status_label(code) }
        })
        .collect();

    Ok(Some(GitStatusInfo { branch, files }))
}

/// Whether `p` (a path relative to the workspace root) is an actual
/// request/gRPC node file — as opposed to storage-layer bookkeeping that
/// also happens to end in `.relay`: `_folder.relay` (folder metadata),
/// `workspace.relay` (root workspace name/variables/environment list), or
/// anything under `environments/` (environment definitions, not requests).
/// Without this, those show up in diffs/history looking exactly like a
/// modified request — e.g. the workspace's own name reads as a request
/// named after it with "no URL set".
fn is_request_file(p: &str) -> bool {
    if !p.ends_with(".relay") {
        return false;
    }
    let file_name = Path::new(p).file_name().and_then(|f| f.to_str()).unwrap_or("");
    if file_name == "_folder.relay" || file_name == "workspace.relay" {
        return false;
    }
    if p.split('/').any(|seg| seg == "environments") {
        return false;
    }
    true
}

/// Finds the `.relay` file whose own JSON body carries `"id": target_id` —
/// request/gRPC node ids are stable across renames, but the filename is
/// name-derived (see storage::slugify) and changes when the request is
/// renamed, so the frontend can't just remember a path. Searching by content
/// also means this needs no knowledge of storage's slug/folder-nesting rules.
fn find_file_by_id(base: &Path, target_id: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(base).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().and_then(|f| f.to_str()) == Some("environments") {
                continue;
            }
            if let Some(found) = find_file_by_id(&path, target_id) {
                return Some(found);
            }
            continue;
        }
        let name = path.file_name()?.to_string_lossy().to_string();
        if name == "_folder.relay" || name == "workspace.relay" || !name.ends_with(".relay") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else { continue };
        let Ok(json) = serde_json::from_str::<Value>(&raw) else { continue };
        if json.get("id").and_then(|v| v.as_str()) == Some(target_id) {
            return Some(path);
        }
    }
    None
}

/// Per-request commit history — the file's whole content at each commit that
/// touched it, so the frontend can diff consecutive versions into an
/// "API changed" summary instead of a raw text diff. `--follow` tracks the
/// file across renames (its filename is derived from the request's name).
#[tauri::command]
pub fn git_history_for_node(dir: String, node_id: String) -> Result<Vec<ApiHistoryEntry>, String> {
    let path = Path::new(&dir);
    if run_git(path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(vec![]);
    }

    let pathspec = relay_pathspec(&dir);
    let search_root = path.join(pathspec);
    let Some(file_path) = find_file_by_id(&search_root, &node_id) else {
        return Ok(vec![]);
    };
    let rel_path = file_path.strip_prefix(path).map_err(|e| e.to_string())?;
    let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");

    const SEP: &str = "\u{1}";
    let log_format = format!("%H{}%an{}%ad{}%s", SEP, SEP, SEP);
    let log_raw = run_git(
        path,
        &["log", "--follow", &format!("--format={}", log_format), "--date=short", "--", &rel_path_str],
    )?;

    let mut entries = Vec::new();
    for line in log_raw.lines() {
        let parts: Vec<&str> = line.split(SEP).collect();
        if parts.len() != 4 {
            continue;
        }
        let hash = parts[0].to_string();
        let content = run_git(path, &["show", &format!("{}:{}", hash, rel_path_str)]).ok();
        entries.push(ApiHistoryEntry {
            hash,
            author: parts[1].to_string(),
            date: parts[2].to_string(),
            message: parts[3].to_string(),
            content,
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn git_list_branches(dir: String) -> Result<Vec<String>, String> {
    let path = Path::new(&dir);
    if run_git(path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(vec![]);
    }
    let raw = run_git(path, &["branch", "--format=%(refname:short)"])?;
    Ok(raw.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect())
}

#[derive(Serialize)]
pub struct BranchDiffEntry {
    pub path: String,
    pub status: String, // "added" | "removed" | "modified"
    pub before: Option<String>,
    pub after: Option<String>,
    // HEAD's content for this path, ONLY populated in working-tree mode
    // (`compare: None`) — lets the frontend split "committed vs base" from
    // "uncommitted on top of HEAD" instead of treating the whole base-vs-
    // working-tree diff as one undifferentiated blob. None in branch-vs-
    // branch mode, where the entire diff is committed by definition.
    pub head: Option<String>,
}

fn node_id_of(content: &Option<String>) -> Option<String> {
    content.as_ref().and_then(|c| serde_json::from_str::<Value>(c).ok())?.get("id").and_then(|v| v.as_str()).map(String::from)
}

/// Every request that differs between two refs, matched by content — a
/// renamed request shows up as one path missing on `base` and one missing on
/// `compare`; before treating those as a genuine add+delete pair, this
/// matches them by their JSON `id` (stable across renames) so a rename
/// (with or without content changes) still reads as one "modified" entry
/// instead of a misleading delete-and-recreate.
/// `compare: None` diffs `base` against the current working tree instead of
/// another ref — `git diff <base>` (no second ref) naturally reflects both
/// staged AND unstaged changes combined, since it's just comparing against
/// whatever's on disk right now. `git diff` alone never surfaces fully
/// untracked files (never `git add`ed even once — a brand-new request
/// nobody has staged yet), so those are folded in separately via
/// `git status` below, working-tree mode only (an untracked file has no
/// place in a plain branch-vs-branch comparison, since it was never part of
/// any commit on either side).
#[tauri::command]
pub fn git_branch_diff(dir: String, base: String, compare: Option<String>) -> Result<Vec<BranchDiffEntry>, String> {
    let path = Path::new(&dir);
    if run_git(path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(vec![]);
    }
    let pathspec = relay_pathspec(&dir);
    let raw = match &compare {
        Some(c) => run_git(path, &["diff", "--name-status", &base, c, "--", pathspec])?,
        None => run_git(path, &["diff", "--name-status", &base, "--", pathspec])?,
    };

    let mut added_paths = Vec::new();
    let mut removed_paths = Vec::new();
    let mut modified_paths = Vec::new();
    for line in raw.lines() {
        let mut parts = line.splitn(2, '\t');
        let status = parts.next().unwrap_or("");
        let p = parts.next().unwrap_or("");
        if p.is_empty() || !is_request_file(p) {
            continue;
        }
        match status.chars().next() {
            Some('A') => added_paths.push(p.to_string()),
            Some('D') => removed_paths.push(p.to_string()),
            Some('M') => modified_paths.push(p.to_string()),
            _ => {}
        }
    }

    if compare.is_none() {
        let status_raw = run_git(path, &["status", "--porcelain", "--untracked-files=all", "--", pathspec]).unwrap_or_default();
        for line in status_raw.lines() {
            if !line.starts_with("??") {
                continue;
            }
            let p = line.get(3..).unwrap_or("");
            if p.is_empty() || !is_request_file(p) {
                continue;
            }
            added_paths.push(p.to_string());
        }
    }

    let show_at = |rev: &str, p: &str| run_git(path, &["show", &format!("{}:{}", rev, p)]).ok();
    // Working-tree content is read straight off disk (not via `git show`,
    // which only knows about commits) — this is what makes it reflect
    // staged AND unstaged edits alike, exactly as they currently sit.
    let show_compare = |p: &str| match &compare {
        Some(c) => show_at(c, p),
        None => fs::read_to_string(path.join(p)).ok(),
    };

    let head_of = |p: &str| -> Option<String> {
        if compare.is_some() {
            return None;
        }
        show_at("HEAD", p)
    };

    let mut entries = Vec::new();
    for p in &modified_paths {
        entries.push(BranchDiffEntry { path: p.clone(), status: "modified".to_string(), before: show_at(&base, p), after: show_compare(p), head: head_of(p) });
    }

    let mut removed_contents: Vec<(String, Option<String>)> = removed_paths.iter().map(|p| (p.clone(), show_at(&base, p))).collect();
    for added_path in &added_paths {
        let after_content = show_compare(added_path);
        let after_id = node_id_of(&after_content);
        let matched = after_id
            .as_ref()
            .and_then(|aid| removed_contents.iter().position(|(_, c)| node_id_of(c).as_deref() == Some(aid.as_str())));
        if let Some(idx) = matched {
            let (_, before_content) = removed_contents.remove(idx);
            entries.push(BranchDiffEntry { path: added_path.clone(), status: "modified".to_string(), before: before_content, after: after_content, head: head_of(added_path) });
        } else {
            entries.push(BranchDiffEntry { path: added_path.clone(), status: "added".to_string(), before: None, after: after_content, head: head_of(added_path) });
        }
    }
    for (p, before_content) in removed_contents {
        let head = head_of(&p);
        entries.push(BranchDiffEntry { path: p, status: "removed".to_string(), before: before_content, after: None, head });
    }

    Ok(entries)
}

#[tauri::command]
pub fn git_init(dir: String) -> Result<(), String> {
    let path = Path::new(&dir);
    run_git(path, &["init"])?;
    Ok(())
}

#[tauri::command]
pub fn git_commit(dir: String, message: String) -> Result<(), String> {
    let path = Path::new(&dir);
    if message.trim().is_empty() {
        return Err("Commit message is required".to_string());
    }
    // Scoped the same way git_status is — see relay_pathspec.
    let pathspec = relay_pathspec(&dir);
    run_git(path, &["add", "-A", pathspec])?;
    run_git(path, &["commit", "-m", message.trim()])?;
    Ok(())
}

/// Stages exactly the given paths (relative to `dir`) — for API-aware
/// partial-field staging, where the frontend has already rewritten a file's
/// on-disk content to a merge of only the selected fields before calling
/// this, and everything else in the working tree must stay untouched.
/// `git add -- <path>` stages creates, modifies, AND deletions of a specific
/// tracked path alike, so this covers added/modified/removed uniformly.
#[tauri::command]
pub fn git_add(dir: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let path = Path::new(&dir);
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(paths.iter().map(|p| p.as_str()));
    run_git(path, &args)?;
    Ok(())
}

/// Commits whatever is currently staged, without touching the index first —
/// the counterpart to `git_add` above for partial-field staging. `git_commit`
/// stays as `add -A` + commit for the simple "commit everything" flow.
#[tauri::command]
pub fn git_commit_staged(dir: String, message: String) -> Result<(), String> {
    let path = Path::new(&dir);
    if message.trim().is_empty() {
        return Err("Commit message is required".to_string());
    }
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

    // relay_pathspec detects hidden mode by checking for .relay/workspace.relay
    // — real saves always write that file, so tests need a stub of it too.
    fn init_hidden_relay(dir: &std::path::Path) {
        fs::create_dir_all(dir.join(".relay")).unwrap();
        fs::write(dir.join(".relay").join("workspace.relay"), "{}").unwrap();
    }

    #[test]
    fn reports_branch_and_untracked_file() {
        let dir = tmp_repo("status");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("a.relay"), "{}").unwrap();
        let info = git_status(dir.to_string_lossy().to_string()).unwrap().expect("should be a repo");
        assert_eq!(info.branch, "main");
        assert_eq!(info.files.len(), 2, "workspace.relay stub + a.relay");
        assert!(info.files.iter().any(|f| f.path == "a.relay" && f.status == "U"), "the .relay/ prefix is stripped for display");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_a_single_unstaged_modification_with_the_full_path() {
        // Regression test for a run_git bug: `.trim()` on the whole porcelain
        // output ate the leading space of " M path" whenever it was the
        // FIRST (and only) character of the output — a lone unstaged-only
        // modification, the single most common status a user can have —
        // silently truncating the reported path's first character.
        let dir = tmp_repo("single-unstaged-mod");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("a.relay"), "{}").unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        fs::write(dir.join(".relay").join("a.relay"), r#"{"v":2}"#).unwrap();

        let info = git_status(dir.to_string_lossy().to_string()).unwrap().unwrap();
        assert_eq!(info.files.len(), 1);
        assert_eq!(info.files[0].path, "a.relay", "must not be truncated to \"relay\"");
        assert_eq!(info.files[0].status, "M");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ignores_changes_outside_the_relay_folder() {
        let dir = tmp_repo("scoped");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("a.relay"), "{}").unwrap();
        // Simulate an unrelated project file sitting next to .relay/ in the
        // same repo — it must never show up in Relay's own status/commit.
        fs::write(dir.join("package.json"), "{}").unwrap();

        let info = git_status(dir.to_string_lossy().to_string()).unwrap().unwrap();
        assert!(info.files.iter().all(|f| f.path != "package.json"));
        assert!(info.files.iter().any(|f| f.path == "a.relay"));

        git_commit(dir.to_string_lossy().to_string(), "commit only .relay".to_string()).expect("commit failed");
        let committed = Command::new("git").args(["show", "--stat", "--format="]).current_dir(&dir).output().unwrap();
        let committed = String::from_utf8_lossy(&committed.stdout);
        assert!(committed.contains(".relay/a.relay"));
        assert!(!committed.contains("package.json"), "unrelated project file must not get committed");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_stages_and_commits_changes() {
        let dir = tmp_repo("commit");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("a.relay"), "{}").unwrap();
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

    #[test]
    fn flat_mode_scopes_to_whole_repo() {
        // No .relay/workspace.relay stub — relay_pathspec should fall back
        // to "." and pick up a file sitting directly at the repo root.
        let dir = tmp_repo("flat-mode");
        fs::write(dir.join("get-repo.relay"), "{}").unwrap();
        let info = git_status(dir.to_string_lossy().to_string()).unwrap().unwrap();
        assert_eq!(info.files.len(), 1);
        assert_eq!(info.files[0].path, "get-repo.relay");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn history_returns_empty_for_unknown_node_or_non_repo() {
        let dir = tmp_repo("history-empty");
        init_hidden_relay(&dir);
        let entries = git_history_for_node(dir.to_string_lossy().to_string(), "nonexistent-id".to_string()).unwrap();
        assert!(entries.is_empty());

        let not_repo = std::env::temp_dir().join("relay-git-test-history-not-repo");
        let _ = fs::remove_dir_all(&not_repo);
        fs::create_dir_all(&not_repo).unwrap();
        let entries2 = git_history_for_node(not_repo.to_string_lossy().to_string(), "x".to_string()).unwrap();
        assert!(entries2.is_empty());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&not_repo).ok();
    }

    #[test]
    fn history_walks_commits_newest_first_with_content() {
        let dir = tmp_repo("history-basic");
        init_hidden_relay(&dir);
        let file = dir.join(".relay").join("get-portfolio.relay");

        fs::write(&file, r#"{"id":"req-1","name":"Get Portfolio","request":{"method":"GET","url":"/v1/portfolio"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "feat: add portfolio endpoint".to_string()).unwrap();

        fs::write(&file, r#"{"id":"req-1","name":"Get Portfolio","request":{"method":"GET","url":"/v2/portfolio"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "feat: bump to v2".to_string()).unwrap();

        let entries = git_history_for_node(dir.to_string_lossy().to_string(), "req-1".to_string()).unwrap();
        assert_eq!(entries.len(), 2, "two commits touched this file");
        assert_eq!(entries[0].message, "feat: bump to v2", "newest commit first");
        assert_eq!(entries[1].message, "feat: add portfolio endpoint");
        assert!(entries[0].content.as_ref().unwrap().contains("/v2/portfolio"));
        assert!(entries[1].content.as_ref().unwrap().contains("/v1/portfolio"));
        assert_ne!(entries[0].hash, entries[1].hash);
        assert_eq!(entries[0].author, "Test");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn history_follows_the_file_across_a_rename() {
        // Renaming the request changes its slug (storage::slugify), so this
        // proves --follow (git's rename-similarity heuristic) plus finding
        // the file by its current name still recovers the full history.
        let dir = tmp_repo("history-rename");
        init_hidden_relay(&dir);
        let old_file = dir.join(".relay").join("old-name.relay");

        fs::write(&old_file, r#"{"id":"req-2","name":"Old Name","request":{"method":"GET","url":"/x"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "initial".to_string()).unwrap();

        // Rename-only commit first (identical content) — git's rename
        // detection is a whole-blob similarity check, and a single-line JSON
        // file has no partial-line matching to fall back on, so renaming
        // and editing content in the very same commit can register as a
        // plain delete+add instead of a detected rename.
        let new_file = dir.join(".relay").join("new-name.relay");
        fs::rename(&old_file, &new_file).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "rename".to_string()).unwrap();

        fs::write(&new_file, r#"{"id":"req-2","name":"New Name","request":{"method":"GET","url":"/y"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "change url after rename".to_string()).unwrap();

        let entries = git_history_for_node(dir.to_string_lossy().to_string(), "req-2".to_string()).unwrap();
        assert_eq!(entries.len(), 3, "history should span the rename");
        assert_eq!(entries[0].message, "change url after rename");
        assert_eq!(entries[1].message, "rename");
        assert_eq!(entries[2].message, "initial");

        fs::remove_dir_all(&dir).ok();
    }

    fn checkout_new_branch(dir: &std::path::Path, name: &str) {
        Command::new("git").args(["checkout", "-q", "-b", name]).current_dir(dir).output().unwrap();
    }

    #[test]
    fn lists_branches() {
        let dir = tmp_repo("list-branches");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("a.relay"), r#"{"id":"a"}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "initial".to_string()).unwrap();
        checkout_new_branch(&dir, "feature/portfolio-v2");

        let branches = git_list_branches(dir.to_string_lossy().to_string()).unwrap();
        assert!(branches.contains(&"main".to_string()));
        assert!(branches.contains(&"feature/portfolio-v2".to_string()));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn branch_diff_detects_added_modified_removed() {
        let dir = tmp_repo("branch-diff-basic");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("keep.relay"), r#"{"id":"keep","request":{"url":"/x"}}"#).unwrap();
        fs::write(dir.join(".relay").join("gone.relay"), r#"{"id":"gone","request":{"url":"/y"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base state".to_string()).unwrap();

        checkout_new_branch(&dir, "feature-x");
        fs::write(dir.join(".relay").join("keep.relay"), r#"{"id":"keep","request":{"url":"/x-v2"}}"#).unwrap();
        fs::remove_file(dir.join(".relay").join("gone.relay")).unwrap();
        fs::write(dir.join(".relay").join("brand-new.relay"), r#"{"id":"brand-new","request":{"url":"/z"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "changes on feature-x".to_string()).unwrap();

        let diff = git_branch_diff(dir.to_string_lossy().to_string(), "main".to_string(), Some("feature-x".to_string())).unwrap();
        assert_eq!(diff.len(), 3, "keep(modified) + gone(removed) + brand-new(added)");

        let modified = diff.iter().find(|e| e.path.contains("keep")).unwrap();
        assert_eq!(modified.status, "modified");
        assert!(modified.before.as_ref().unwrap().contains("/x\""));
        assert!(modified.after.as_ref().unwrap().contains("/x-v2"));

        let removed = diff.iter().find(|e| e.path.contains("gone")).unwrap();
        assert_eq!(removed.status, "removed");
        assert!(removed.before.is_some());
        assert!(removed.after.is_none());

        let added = diff.iter().find(|e| e.path.contains("brand-new")).unwrap();
        assert_eq!(added.status, "added");
        assert!(added.before.is_none());
        assert!(added.after.is_some());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn branch_diff_matches_a_rename_across_branches_as_modified() {
        let dir = tmp_repo("branch-diff-rename");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("old-name.relay"), r#"{"id":"stable-id","request":{"url":"/a"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        checkout_new_branch(&dir, "rename-branch");
        fs::rename(dir.join(".relay").join("old-name.relay"), dir.join(".relay").join("new-name.relay")).unwrap();
        fs::write(dir.join(".relay").join("new-name.relay"), r#"{"id":"stable-id","request":{"url":"/b"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "renamed + changed".to_string()).unwrap();

        let diff = git_branch_diff(dir.to_string_lossy().to_string(), "main".to_string(), Some("rename-branch".to_string())).unwrap();
        assert_eq!(diff.len(), 1, "same id across the rename should collapse into one modified entry, not add+delete");
        assert_eq!(diff[0].status, "modified");
        assert!(diff[0].before.as_ref().unwrap().contains("/a"));
        assert!(diff[0].after.as_ref().unwrap().contains("/b"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn branch_diff_against_working_tree_sees_staged_and_unstaged() {
        let dir = tmp_repo("branch-diff-worktree");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("staged.relay"), r#"{"id":"staged-id","request":{"url":"/before-staged"}}"#).unwrap();
        fs::write(dir.join(".relay").join("unstaged.relay"), r#"{"id":"unstaged-id","request":{"url":"/before-unstaged"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        // Stage one change (git add, no commit)...
        fs::write(dir.join(".relay").join("staged.relay"), r#"{"id":"staged-id","request":{"url":"/after-staged"}}"#).unwrap();
        Command::new("git").args(["add", ".relay/staged.relay"]).current_dir(&dir).output().unwrap();
        // ...and leave another change fully unstaged.
        fs::write(dir.join(".relay").join("unstaged.relay"), r#"{"id":"unstaged-id","request":{"url":"/after-unstaged"}}"#).unwrap();

        let diff = git_branch_diff(dir.to_string_lossy().to_string(), "main".to_string(), None).unwrap();
        assert_eq!(diff.len(), 2, "working-tree diff should see both the staged and the unstaged change");

        let staged = diff.iter().find(|e| e.path.contains("staged.relay") && !e.path.contains("unstaged")).unwrap();
        assert!(staged.after.as_ref().unwrap().contains("/after-staged"), "staged change reflected");

        let unstaged = diff.iter().find(|e| e.path.contains("unstaged.relay")).unwrap();
        assert!(unstaged.after.as_ref().unwrap().contains("/after-unstaged"), "unstaged change reflected too");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn branch_diff_against_working_tree_sees_a_brand_new_untracked_file() {
        // A file `git add` has never touched (a newly-created request nobody
        // has staged yet) — plain `git diff` alone would miss this entirely.
        let dir = tmp_repo("branch-diff-untracked");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("existing.relay"), r#"{"id":"existing-id","request":{"url":"/x"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        fs::write(dir.join(".relay").join("brand-new.relay"), r#"{"id":"new-id","request":{"method":"POST","url":"/new"}}"#).unwrap();

        let diff = git_branch_diff(dir.to_string_lossy().to_string(), "main".to_string(), None).unwrap();
        assert_eq!(diff.len(), 1, "the untracked new request should be detected");
        assert_eq!(diff[0].status, "added");
        assert!(diff[0].path.contains("brand-new"));
        assert!(diff[0].after.as_ref().unwrap().contains("new-id"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn branch_diff_excludes_workspace_meta_and_environment_files() {
        // Regression test: workspace.relay (root name/variables/env list) and
        // environments/*.relay are NOT requests — they used to slip through
        // the ".relay" extension filter and show up in the diff looking
        // exactly like a modified request named after the workspace itself.
        let dir = tmp_repo("branch-diff-excludes-meta");
        init_hidden_relay(&dir);
        fs::create_dir_all(dir.join(".relay").join("environments")).unwrap();
        fs::write(dir.join(".relay").join("environments").join("local.relay"), r#"{"id":"env-1","name":"Local","variables":[]}"#).unwrap();
        fs::write(dir.join(".relay").join("real-request.relay"), r#"{"id":"req-1","request":{"method":"GET","url":"/x"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        // Change the workspace name (rewrites workspace.relay), an environment,
        // AND a real request, all in the same commit.
        fs::write(dir.join(".relay").join("workspace.relay"), r#"{"name":"renamed-workspace","variables":[],"activeEnvironmentId":null,"protoLibrary":[],"order":[],"environmentOrder":[]}"#).unwrap();
        fs::write(dir.join(".relay").join("environments").join("local.relay"), r#"{"id":"env-1","name":"Local","variables":[{"key":"x"}]}"#).unwrap();
        fs::write(dir.join(".relay").join("real-request.relay"), r#"{"id":"req-1","request":{"method":"POST","url":"/x"}}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "changes".to_string()).unwrap();

        let diff = git_branch_diff(dir.to_string_lossy().to_string(), "HEAD~1".to_string(), Some("HEAD".to_string())).unwrap();
        assert_eq!(diff.len(), 1, "only the real request should appear, not workspace.relay or the environment file");
        assert!(diff[0].path.contains("real-request"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn git_add_stages_only_the_given_paths() {
        let dir = tmp_repo("add-specific-paths");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("a.relay"), r#"{"id":"a"}"#).unwrap();
        fs::write(dir.join(".relay").join("b.relay"), r#"{"id":"b"}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        fs::write(dir.join(".relay").join("a.relay"), r#"{"id":"a","v":2}"#).unwrap();
        fs::write(dir.join(".relay").join("b.relay"), r#"{"id":"b","v":2}"#).unwrap();

        git_add(dir.to_string_lossy().to_string(), vec![".relay/a.relay".to_string()]).unwrap();

        let staged = run_git(&dir, &["diff", "--cached", "--name-only"]).unwrap();
        assert!(staged.contains("a.relay"), "a.relay should be staged");
        assert!(!staged.contains("b.relay"), "b.relay must stay untouched");

        let unstaged = run_git(&dir, &["diff", "--name-only"]).unwrap();
        assert!(unstaged.contains("b.relay"), "b.relay's edit is still a pending unstaged change");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn git_add_stages_a_deletion() {
        let dir = tmp_repo("add-deletion");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("gone.relay"), r#"{"id":"gone"}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        fs::remove_file(dir.join(".relay").join("gone.relay")).unwrap();
        git_add(dir.to_string_lossy().to_string(), vec![".relay/gone.relay".to_string()]).unwrap();

        let staged = run_git(&dir, &["diff", "--cached", "--name-status"]).unwrap();
        assert!(staged.starts_with('D'), "the deletion should be staged: {staged}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn git_commit_staged_commits_only_what_was_added() {
        let dir = tmp_repo("commit-staged");
        init_hidden_relay(&dir);
        fs::write(dir.join(".relay").join("a.relay"), r#"{"id":"a"}"#).unwrap();
        fs::write(dir.join(".relay").join("b.relay"), r#"{"id":"b"}"#).unwrap();
        git_commit(dir.to_string_lossy().to_string(), "base".to_string()).unwrap();

        fs::write(dir.join(".relay").join("a.relay"), r#"{"id":"a","v":2}"#).unwrap();
        fs::write(dir.join(".relay").join("b.relay"), r#"{"id":"b","v":2}"#).unwrap();
        git_add(dir.to_string_lossy().to_string(), vec![".relay/a.relay".to_string()]).unwrap();

        git_commit_staged(dir.to_string_lossy().to_string(), "partial commit".to_string()).unwrap();

        let status = git_status(dir.to_string_lossy().to_string()).unwrap().unwrap();
        assert_eq!(status.files.len(), 1, "only b.relay's edit should remain pending");
        assert_eq!(status.files[0].path, "b.relay");

        let committed_log = run_git(&dir, &["log", "-1", "--format=%s"]).unwrap();
        assert_eq!(committed_log, "partial commit");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn git_commit_staged_requires_a_message() {
        let dir = tmp_repo("commit-staged-empty-message");
        let err = git_commit_staged(dir.to_string_lossy().to_string(), "  ".to_string());
        assert!(err.is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
