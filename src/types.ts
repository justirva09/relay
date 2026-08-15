export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface KVRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export type BodyMode = "none" | "json" | "text";

export interface RequestData {
  method: Method;
  url: string;
  params: KVRow[];
  headers: KVRow[];
  bodyMode: BodyMode;
  bodyText: string;
  preScript: string;
  testScript: string;
}

export type GrpcMethodType = "unary" | "server-stream" | "client-stream" | "bidi";

export interface GrpcRequestData {
  url: string;
  service: string;
  method: string;
  methodType: GrpcMethodType;
  messageJson: string;
  metadata: KVRow[];
  protoSource: "reflection" | "imported";
  activeProtoFile?: string;
}

export interface ProtoLibraryFile {
  name: string;
  content: string;
}

export interface GrpcLogEntry {
  id: string;
  timestamp: number;
  direction: "sent" | "received" | "error";
  json: string;
}

export interface FolderNode {
  id: string;
  kind: "folder";
  name: string;
  collapsed?: boolean;
  children: TreeNode[];
}

export interface RequestNode {
  id: string;
  kind: "request";
  name: string;
  request: RequestData;
}

export interface GrpcRequestNode {
  id: string;
  kind: "grpc";
  name: string;
  request: GrpcRequestData;
}

export type TreeNode = FolderNode | RequestNode | GrpcRequestNode;

export interface Environment {
  id: string;
  name: string;
  variables: KVRow[];
}

export interface Workspace {
  name: string;
  tree: TreeNode[];
  variables: KVRow[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  protoLibrary: ProtoLibraryFile[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ResponseState {
  status: number | null;
  statusText: string;
  ok: boolean;
  time: number;
  size: number;
  headers: [string, string][];
  body: string;
  error: string | null;
  testResults: TestResult[];
  logs: string[];
  preError: string | null;
}

export interface HttpTabState {
  nodeId: string;
  kind: "http";
  draft: RequestData;
  dirty: boolean;
  response: ResponseState | null;
  loading: boolean;
}

export interface GrpcResponseSummary {
  ok: boolean;
  durationMs: number | null;
  sizeBytes: number;
  metadata: [string, string][];
  body: string;
  error: string | null;
}

export interface GrpcTabState {
  nodeId: string;
  kind: "grpc";
  draft: GrpcRequestData;
  dirty: boolean;
  log: GrpcLogEntry[];
  streaming: boolean;
  lastResponse: GrpcResponseSummary | null;
}

export type TabState = HttpTabState | GrpcTabState;

export const uid = () =>
  (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function newRow(): KVRow {
  return { id: uid(), key: "", value: "", enabled: true };
}

export function parseQueryToRows(fullUrl: string, existingRows?: KVRow[]): KVRow[] {
  const qIndex = fullUrl.indexOf("?");
  const qs = qIndex === -1 ? "" : fullUrl.slice(qIndex + 1);
  if (!qs) return [newRow()];
  const pairs = qs.split("&").filter(Boolean);
  const rows = pairs.map((pair) => {
    const [k, v = ""] = pair.split("=");
    let key = k;
    let value = v;
    try {
      key = decodeURIComponent(k || "");
      value = decodeURIComponent(v || "");
    } catch {
      // keep raw on malformed encoding
    }
    const existing = existingRows?.find((r) => r.key === key);
    return { id: uid(), key, value, enabled: existing ? existing.enabled : true };
  });
  rows.push(newRow());
  return rows;
}

export function buildUrlFromParams(fullUrl: string, rows: KVRow[]): string {
  const qIndex = fullUrl.indexOf("?");
  const base = qIndex === -1 ? fullUrl : fullUrl.slice(0, qIndex);
  const qs = rows
    .filter((r) => r.enabled && r.key.trim())
    .map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`)
    .join("&");
  return qs ? `${base}?${qs}` : base;
}

export function defaultRequest(method: Method = "GET", url = ""): RequestData {
  return {
    method,
    url,
    params: parseQueryToRows(url),
    headers: [newRow()],
    bodyMode: "none",
    bodyText: "",
    preScript: "",
    testScript: "",
  };
}

export function defaultMessageForMethodType(methodType: GrpcMethodType): string {
  return methodType === "client-stream" || methodType === "bidi" ? "[]" : "{}";
}

export function defaultGrpcRequest(url = "grpc://localhost:50051"): GrpcRequestData {
  return {
    url,
    service: "",
    method: "",
    methodType: "unary",
    messageJson: "{}",
    metadata: [newRow()],
    protoSource: "reflection",
  };
}

export function demoWorkspace(name = "My Workspace"): Workspace {
  return {
    name,
    variables: [newRow()],
    environments: [],
    activeEnvironmentId: null,
    protoLibrary: [],
    tree: [
      {
        id: uid(),
        kind: "folder",
        name: "GitHub API",
        children: [
          {
            id: uid(),
            kind: "request",
            name: "Search repos",
            request: defaultRequest("GET", "https://api.github.com/search/repositories?q=anthropic&per_page=5"),
          },
          {
            id: uid(),
            kind: "request",
            name: "Get user",
            request: defaultRequest("GET", "https://api.github.com/users/anthropics"),
          },
        ],
      },
      {
        id: uid(),
        kind: "folder",
        name: "Examples",
        children: [
          {
            id: uid(),
            kind: "request",
            name: "Create post (jsonplaceholder)",
            request: {
              ...defaultRequest("POST", "https://jsonplaceholder.typicode.com/posts"),
              bodyMode: "json",
              bodyText: '{\n  "title": "hello",\n  "body": "from lite postman",\n  "userId": 1\n}',
            },
          },
        ],
      },
      {
        id: uid(),
        kind: "folder",
        name: "gRPC Examples",
        children: [
          {
            id: uid(),
            kind: "grpc",
            name: "SayHello (unary)",
            request: {
              ...defaultGrpcRequest(),
              service: "helloworld.Greeter",
              method: "SayHello",
              methodType: "unary",
              messageJson: '{\n  "name": "Relay"\n}',
            },
          },
        ],
      },
    ],
  };
}
