import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface NativeHttpResponse {
  status: number;
  status_text: string;
  ok: boolean;
  time_ms: number;
  size_bytes: number;
  headers: [string, string][];
  body: string;
}

export interface NativeFormDataField {
  key: string;
  value: string;
  is_file: boolean;
}

export interface NativeHttpRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  form_data?: NativeFormDataField[];
  // 0/undefined means "use Relay's default" on the Rust side.
  timeout_ms?: number;
  follow_redirects?: boolean;
  max_redirects?: number;
}

// Runs the actual network call in Rust (reqwest), so there's no browser CORS
// restriction and no webview overhead — this is the whole point of going
// native instead of using fetch() from the frontend.
export function sendHttpRequest(payload: NativeHttpRequest): Promise<NativeHttpResponse> {
  return invoke("http_request", { payload });
}

export interface OAuthCallbackResult {
  code: string | null;
  state: string | null;
  error: string | null;
}

// Binds a one-shot local listener on 127.0.0.1:<port>/callback and resolves
// with the first request it receives — the OAuth2 provider's redirect after
// the user approves in their system browser. Must be awaited (not just
// fire-and-forget) before opening the browser tab, so there's no race
// between the redirect arriving and this being ready to catch it.
export function oauth2AwaitCallback(port: number, timeoutSecs: number): Promise<OAuthCallbackResult> {
  return invoke("oauth2_await_callback", { port, timeoutSecs });
}

// Local-only, per-workspace-folder cookie jar — see cookie_jar.rs. Never
// part of the .relay files themselves.
export function loadCookieJar(workspaceDir: string): Promise<string> {
  return invoke("load_cookie_jar", { workspaceDir });
}

export function saveCookieJar(workspaceDir: string, data: string): Promise<void> {
  return invoke("save_cookie_jar", { workspaceDir, data });
}

export async function loadWorkspaceFile(): Promise<string | null> {
  const raw = await invoke<string>("load_workspace");
  if (!raw || raw === "null") return null;
  return raw;
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return result as string | null;
}

export function getLastWorkspaceDir(): Promise<string | null> {
  return invoke("get_last_workspace_dir");
}

export function setLastWorkspaceDir(dir: string): Promise<void> {
  return invoke("set_last_workspace_dir", { dir });
}

export interface LoadedWorkspace {
  workspace: string | null; // JSON string, caller parses into Workspace
  hidden: boolean;
}

export async function loadWorkspaceDir(dir: string): Promise<LoadedWorkspace> {
  const raw = await invoke<string>("load_workspace_dir", { dir });
  const envelope = JSON.parse(raw) as { workspace: unknown; hidden: boolean };
  return {
    workspace: envelope.workspace === null ? null : JSON.stringify(envelope.workspace),
    hidden: envelope.hidden,
  };
}

export function saveWorkspaceDir(dir: string, data: string, hidden: boolean): Promise<void> {
  return invoke("save_workspace_dir", { dir, data, hidden });
}

// Whether the picked folder already has files besides dotfiles — used to
// decide whether to offer a flat (visible-at-root) layout at all, or force
// the isolated .relay/ subfolder so an existing project's files aren't at risk.
export function dirHasOtherFiles(dir: string): Promise<boolean> {
  return invoke("dir_has_other_files", { dir });
}

export async function pickJsonFile(): Promise<string | null> {
  const result = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });
  return result as string | null;
}

export async function pickCollectionFile(): Promise<string | null> {
  const result = await open({
    filters: [{ name: "Collection / OpenAPI", extensions: ["json", "yaml", "yml"] }],
    multiple: false,
  });
  return result as string | null;
}

export async function pickProtoFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return result as string | null;
}

export async function pickAnyFile(): Promise<string | null> {
  const result = await open({ multiple: false });
  return result as string | null;
}

export async function pickSavePath(defaultName: string, filterName = "JSON", extensions = ["json"]): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions }],
  });
  return result as string | null;
}

export function readFileAtPath(path: string): Promise<string> {
  return invoke("read_file_at_path", { path });
}

export function writeFileAtPath(path: string, data: string): Promise<void> {
  return invoke("write_file_at_path", { path, data });
}

export function listProtoFilesInDir(dir: string): Promise<{ name: string; content: string }[]> {
  return invoke("list_proto_files_in_dir", { dir });
}

export interface GitFileChange {
  path: string;
  status: string;
}

export interface GitStatusInfo {
  branch: string;
  files: GitFileChange[];
}

export function gitStatus(dir: string): Promise<GitStatusInfo | null> {
  return invoke("git_status", { dir });
}

export function gitInit(dir: string): Promise<void> {
  return invoke("git_init", { dir });
}

export interface ApiHistoryEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
  content: string | null;
}

export function gitHistoryForNode(dir: string, nodeId: string): Promise<ApiHistoryEntry[]> {
  return invoke("git_history_for_node", { dir, nodeId });
}

export function gitListBranches(dir: string): Promise<string[]> {
  return invoke("git_list_branches", { dir });
}

export interface BranchDiffEntry {
  path: string;
  status: "added" | "removed" | "modified";
  before: string | null;
  after: string | null;
  // HEAD's content, only populated in working-tree mode (compare: null) —
  // lets the UI split committed-vs-base from uncommitted-on-top-of-HEAD.
  head: string | null;
}

// compare: null diffs `base` against the current working tree (staged +
// unstaged combined) instead of another branch — see git_branch_diff.
// includeHead: fetches each changed file's HEAD content too (one extra git
// subprocess per file) for the committed-vs-uncommitted line tagging — pass
// false for a bulk listing where nothing reads `.head` yet, and fetch it
// on demand per entry with gitShowAtRef instead (see BranchComparePanel).
export function gitBranchDiff(dir: string, base: string, compare: string | null, includeHead: boolean): Promise<BranchDiffEntry[]> {
  return invoke("git_branch_diff", { dir, base, compare, includeHead });
}

// Single-file on-demand fetch — the lazy counterpart to gitBranchDiff's
// includeHead, so only entries a user actually expands pay for it.
export function gitShowAtRef(dir: string, rev: string, path: string): Promise<string | null> {
  return invoke("git_show_at_ref", { dir, rev, path });
}

export interface PerfStats {
  cpu_percent: number;
  memory_bytes: number;
  uptime_secs: number;
  pid: number;
}

export function getPerfStats(): Promise<PerfStats | null> {
  return invoke("get_perf_stats");
}

// Stages exactly these paths (relative to dir) — for partial-field staging,
// paired with writing a merged file to disk first. See git_add.
export function gitAdd(dir: string, paths: string[]): Promise<void> {
  return invoke("git_add", { dir, paths });
}

// Commits whatever is currently staged, without an implicit `add -A` first —
// the counterpart to gitAdd above.
export function gitCommitStaged(dir: string, message: string): Promise<void> {
  return invoke("git_commit_staged", { dir, message });
}

export interface VersionStatus {
  blocked: boolean;
  message: string;
}

export function checkVersionStatus(): Promise<VersionStatus> {
  return invoke("check_version_status");
}

// Local-only cache of each request's last response, keyed by workspace
// folder — never part of the committed .relay files (see response_cache.rs).
export function loadResponseCache(workspaceDir: string): Promise<string> {
  return invoke("load_response_cache", { workspaceDir });
}

export function saveResponseCache(workspaceDir: string, data: string): Promise<void> {
  return invoke("save_response_cache", { workspaceDir, data });
}

// A local stand-in HTTP server, not the real backend — replies from this
// workspace's cached example responses so a frontend can develop against an
// API that isn't running (or isn't done) yet. See mock_server.rs.
export function startMockServer(workspaceDir: string, port: number): Promise<void> {
  return invoke("start_mock_server", { workspaceDir, port });
}

export function stopMockServer(): Promise<void> {
  return invoke("stop_mock_server");
}

export function mockServerStatus(): Promise<number | null> {
  return invoke("mock_server_status");
}
