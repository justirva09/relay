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
}

// Runs the actual network call in Rust (reqwest), so there's no browser CORS
// restriction and no webview overhead — this is the whole point of going
// native instead of using fetch() from the frontend.
export function sendHttpRequest(payload: NativeHttpRequest): Promise<NativeHttpResponse> {
  return invoke("http_request", { payload });
}

export async function loadWorkspaceFile(): Promise<string | null> {
  const raw = await invoke<string>("load_workspace");
  if (!raw || raw === "null") return null;
  return raw;
}

export function saveWorkspaceFile(data: string): Promise<void> {
  return invoke("save_workspace", { data });
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

export function gitCommit(dir: string, message: string): Promise<void> {
  return invoke("git_commit", { dir, message });
}

export function gitInit(dir: string): Promise<void> {
  return invoke("git_init", { dir });
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
