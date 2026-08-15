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

export interface NativeHttpRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
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

export async function pickJsonFile(): Promise<string | null> {
  const result = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });
  return result as string | null;
}

export async function pickProtoFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return result as string | null;
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
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
