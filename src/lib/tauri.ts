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

// Actual network call happens in Rust (reqwest), not the webview's fetch().
// No CORS restrictions that way.
export function sendHttpRequest(payload: NativeHttpRequest): Promise<NativeHttpResponse> {
  return invoke("http_request", { payload });
}

export interface OAuthCallbackResult {
  code: string | null;
  state: string | null;
  error: string | null;
}

// Listens once on 127.0.0.1:<port>/callback for the OAuth2 redirect after
// the user approves in their system browser. Await this before opening the
// browser tab or you can miss the redirect.
export function oauth2AwaitCallback(port: number, timeoutSecs: number): Promise<OAuthCallbackResult> {
  return invoke("oauth2_await_callback", { port, timeoutSecs });
}

// Local-only, per-workspace cookie jar. Never part of the .relay files.
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

// Whether the folder already has non-dotfile content. If so, force the
// isolated .relay/ subfolder instead of a flat layout.
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
  // Only populated in working-tree mode (compare: null), splits
  // committed-vs-base from uncommitted-on-top-of-HEAD.
  head: string | null;
}

// compare: null diffs `base` against the working tree instead of another
// branch. includeHead costs one extra git subprocess per file, so pass
// false for a bulk listing and fetch on demand with gitShowAtRef instead.
export function gitBranchDiff(dir: string, base: string, compare: string | null, includeHead: boolean): Promise<BranchDiffEntry[]> {
  return invoke("git_branch_diff", { dir, base, compare, includeHead });
}

// Lazy counterpart to includeHead above: only expanded entries pay for it.
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

// Stages exactly these paths, for partial-field staging after writing a
// merged file to disk first.
export function gitAdd(dir: string, paths: string[]): Promise<void> {
  return invoke("git_add", { dir, paths });
}

// Commits whatever's staged, no implicit `add -A`.
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

// Local-only cache of each request's last response, keyed by workspace.
// Never part of the committed .relay files.
export function loadResponseCache(workspaceDir: string): Promise<string> {
  return invoke("load_response_cache", { workspaceDir });
}

export function saveResponseCache(workspaceDir: string, data: string): Promise<void> {
  return invoke("save_response_cache", { workspaceDir, data });
}

// Serves this workspace's cached example responses, so a frontend can be
// built against an API that isn't running yet.
export function startMockServer(workspaceDir: string, port: number): Promise<void> {
  return invoke("start_mock_server", { workspaceDir, port });
}

export function stopMockServer(): Promise<void> {
  return invoke("stop_mock_server");
}

export function mockServerStatus(): Promise<number | null> {
  return invoke("mock_server_status");
}
