export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface KVRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export type BodyMode = "none" | "json" | "text" | "form-data" | "urlencoded";

export interface FormDataRow extends KVRow {
  type: "text" | "file";
}

export function newFormDataRow(): FormDataRow {
  return { ...newRow(), type: "text" };
}

// Discriminated union so later auth types (AWS SigV4, OAuth2) slot in as
// more optional variant fields without restructuring existing requests.
export type AuthType = "none" | "bearer" | "basic";

export interface AuthConfig {
  type: AuthType;
  bearer?: { token: string };
  basic?: { username: string; password: string };
}

export function defaultAuth(): AuthConfig {
  return { type: "none" };
}

// A saved response snapshot the mock server can serve back — the same data
// a real send already produces (ResponseState), pared down to what a mock
// route needs and kept inside RequestData so it's committed to `.relay`
// with the request instead of living in the ephemeral response cache.
export interface Example {
  id: string;
  name: string;
  status: number;
  headers: [string, string][];
  body: string;
  // Exactly one example (per request) should be isDefault at a time — the
  // one the local mock server serves. Not enforced by the type; callers
  // (setDefaultExample) keep that invariant.
  isDefault?: boolean;
  // The X-Mock-Scenario value that selects this example — defaults to a
  // slugified `name` when unset (see slugify() in RequestPanel.tsx and
  // mock_server.rs), but is independently editable so the display name can
  // stay descriptive ("Portfolio — Not Found") while the header stays short
  // ("not-found").
  scenarioKey?: string;
}

export interface RequestData {
  method: Method;
  url: string;
  description: string;
  params: KVRow[];
  pathParams: KVRow[];
  headers: KVRow[];
  auth: AuthConfig;
  bodyMode: BodyMode;
  bodyText: string;
  bodyForm: FormDataRow[];
  bodyUrlencoded: KVRow[];
  preScript: string;
  testScript: string;
  examples: Example[];
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

// What was actually sent over the wire (after variable substitution, Auth
// tab header injection, auto Content-Type, etc.) — captured regardless of
// whether the request succeeded, so a failure is debuggable too.
export interface SentRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
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
  request: SentRequest;
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

// Postman-style :paramName path segments — a fresh row per unique name
// found in the URL's path (before "?"), preserving an existing row's value
// when the name is still present so retyping the URL doesn't clear values.
export function parsePathParamsFromUrl(fullUrl: string, existingRows?: KVRow[]): KVRow[] {
  const qIndex = fullUrl.indexOf("?");
  const pathPart = qIndex === -1 ? fullUrl : fullUrl.slice(0, qIndex);
  const names: string[] = [];
  const re = /:([A-Za-z_]\w*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pathPart)) !== null) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names.map((name) => existingRows?.find((r) => r.key === name) ?? { id: uid(), key: name, value: "", enabled: true });
}

// Backfills fields added to RequestData after some workspaces were already
// saved to disk (e.g. pathParams) so opening an older request doesn't crash.
export function normalizeRequestData(req: any): RequestData {
  return {
    ...req,
    pathParams: Array.isArray(req.pathParams) ? req.pathParams : parsePathParamsFromUrl(req.url ?? "", req.pathParams),
    bodyForm: Array.isArray(req.bodyForm) ? req.bodyForm : [newFormDataRow()],
    bodyUrlencoded: Array.isArray(req.bodyUrlencoded) ? req.bodyUrlencoded : [newRow()],
    description: typeof req.description === "string" ? req.description : "",
    auth: req.auth && typeof req.auth === "object" ? req.auth : defaultAuth(),
    examples: Array.isArray(req.examples) ? req.examples : [],
  };
}

// Names a fresh saved example from its response — timestamp keeps repeated
// saves of the same status from colliding, user can rename afterward.
export function nameExample(status: number, statusText: string): string {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${status} ${statusText || ""}`.trim() + ` · ${time}`;
}

export function encodeUrlencodedRows(rows: KVRow[]): string {
  return rows
    .filter((r) => r.enabled && r.key.trim())
    .map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`)
    .join("&");
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
    description: "",
    params: parseQueryToRows(url),
    pathParams: parsePathParamsFromUrl(url),
    headers: [newRow()],
    auth: defaultAuth(),
    bodyMode: "none",
    bodyText: "",
    bodyForm: [newFormDataRow()],
    bodyUrlencoded: [newRow()],
    preScript: "",
    testScript: "",
    examples: [],
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
        name: "JSONPlaceholder API",
        children: [
          {
            id: uid(),
            kind: "request",
            name: "List posts",
            request: defaultRequest("GET", "https://jsonplaceholder.typicode.com/posts?_limit=5"),
          },
          {
            id: uid(),
            kind: "request",
            name: "Get post by ID",
            request: {
              ...defaultRequest("GET", "https://jsonplaceholder.typicode.com/posts/:id"),
              pathParams: [{ id: uid(), key: "id", value: "1", enabled: true }],
            },
          },
          {
            id: uid(),
            kind: "request",
            name: "Create post",
            request: {
              ...defaultRequest("POST", "https://jsonplaceholder.typicode.com/posts"),
              bodyMode: "json",
              bodyText: '{\n  "title": "hello",\n  "body": "from Relay",\n  "userId": 1\n}',
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
