# gRPC Support — Phase 1 (UI/UX, mocked backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full gRPC request-composing UI (new node kind, sidebar creation flow, service/method picker, message editor, metadata, streaming response log) against static mock data, so the interaction design can be reviewed before any Rust backend work begins.

**Architecture:** Add a third `TreeNode`/`TabState` kind (`"grpc"`) alongside the existing `"folder"`/`"request"` kinds, following the same discriminated-union pattern already used in `types.ts`. All gRPC-specific UI lives in new files (`GrpcPanel.tsx`, `GrpcServicePicker.tsx`, `GrpcResponseLog.tsx`); existing HTTP-only code (`RequestPanel.tsx`, `useSendRequest.ts`, `postman.ts`) is touched only where it narrows on `kind` and needs to explicitly exclude/handle the new kind. A mock catalog + mock streaming simulator (`src/lib/grpcMock.ts`) stands in for the real `tonic`/`prost-reflect` backend that Phase 2 will add later.

**Tech Stack:** React 18 + TypeScript (existing), Tailwind CSS with the existing `th-*` design-token classes. No new dependencies for this phase (no Rust changes).

**Spec:** `docs/superpowers/specs/2026-08-14-grpc-support-design.md`

## Global Constraints

- This project is **not a git repository** (verified via `git status` → "Not a git repository"). Skip every git commit step below — tasks end after verification, nothing is committed.
- **No test framework exists** (no jest/vitest in `package.json`, no Rust `#[test]` modules). Verification for every task is `npx tsc --noEmit` followed by `npx vite build`, both run from `/Users/muhammadirva/Downloads/Lite Postman Tauri`. The final task adds a manual interaction checklist since there is no automated UI test harness.
- Use only the existing Tailwind `th-*` design tokens (`bg-th-surface`, `text-th-text-1`, `border-th-border-input`, etc.) for any new UI — never hardcoded hex colors or bare Tailwind slate/gray classes, to stay consistent with the dark/light theme system already built.
- Reuse existing components instead of duplicating logic: `CodeEditor` (JSON editor with syntax highlighting) for the message body, `KeyValueEditor` for metadata, and the JSON tree renderer extracted in Task 1 for response display.
- Phase 1 makes **no Rust changes** and **no new npm dependencies**. Everything is mocked in TypeScript.
- If executed via subagent-driven-development: cap at **5 concurrent/total subagents**, model **`sonnet`**, per explicit user instruction.

---

### Task 1: Extract shared JSON tree renderer

**Files:**
- Create: `src/components/JsonTree.tsx`
- Modify: `src/components/ResponsePanel.tsx:1-135`

**Interfaces:**
- Produces: `JsonTree({ text: string })` (React component, default export... actually named export, see below) and `isJson(text: string): boolean`, both exported from `src/components/JsonTree.tsx`. Later tasks (`GrpcResponseLog.tsx`, Task 7) import these two names from `"./JsonTree"`.

`ResponsePanel.tsx` currently defines `Toggle`, `JsonValue`, `JsonNode`, `isJson`, and `JsonTree` inline (lines 16–135). This task moves all five into a new file so `GrpcResponseLog.tsx` (Task 7) can reuse the exact same JSON rendering (including the `text-th-syn-*` syntax color tokens) instead of duplicating ~120 lines.

- [ ] **Step 1: Create `src/components/JsonTree.tsx`**

```tsx
import React, { useState } from "react";

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center w-[14px] h-[14px] text-[9px] text-th-text-4 hover:text-th-text-1 select-none shrink-0"
    >
      {open ? "▼" : "▶"}
    </button>
  );
}

function JsonValue({ value, isLast }: { value: string | number | boolean | null; isLast: boolean }) {
  let cls = "text-th-text-1";
  let display: string;
  if (value === null) {
    cls = "text-th-syn-null";
    display = "null";
  } else if (typeof value === "boolean") {
    cls = "text-th-syn-bool";
    display = String(value);
  } else if (typeof value === "number") {
    cls = "text-th-syn-number";
    display = String(value);
  } else {
    cls = "text-th-syn-string";
    display = JSON.stringify(value);
  }
  return (
    <>
      <span className={cls}>{display}</span>
      {!isLast && <span className="text-th-text-3">,</span>}
    </>
  );
}

function JsonNode({ data, name, isLast, depth }: { data: any; name?: string; isLast: boolean; depth: number }) {
  const [open, setOpen] = useState(true);
  const indent = depth * 16;

  const nameEl = name !== undefined ? (
    <>
      <span className="text-th-syn-key">{JSON.stringify(name)}</span>
      <span className="text-th-text-3">: </span>
    </>
  ) : null;

  if (data === null || typeof data !== "object") {
    return (
      <div className="leading-[22px]" style={{ paddingLeft: indent }}>
        {nameEl}
        <JsonValue value={data} isLast={isLast} />
      </div>
    );
  }

  const isArray = Array.isArray(data);
  const entries = isArray ? data : Object.keys(data);
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";
  const count = entries.length;

  if (count === 0) {
    return (
      <div className="leading-[22px]" style={{ paddingLeft: indent }}>
        {nameEl}
        <span className="text-th-text-3">{bracketOpen}{bracketClose}</span>
        {!isLast && <span className="text-th-text-3">,</span>}
      </div>
    );
  }

  return (
    <div>
      <div className="leading-[22px]" style={{ paddingLeft: indent }}>
        <Toggle open={open} onClick={() => setOpen((o) => !o)} />
        {nameEl}
        <span className="text-th-text-3">{bracketOpen}</span>
        {!open && (
          <>
            <span className="text-th-text-4 text-[11px] mx-1">{count} {isArray ? (count === 1 ? "item" : "items") : (count === 1 ? "key" : "keys")}</span>
            <span className="text-th-text-3">{bracketClose}</span>
            {!isLast && <span className="text-th-text-3">,</span>}
          </>
        )}
      </div>
      {open && (
        <>
          {isArray
            ? data.map((item: any, i: number) => (
                <JsonNode key={i} data={item} isLast={i === data.length - 1} depth={depth + 1} />
              ))
            : Object.keys(data).map((key, i) => (
                <JsonNode key={key} data={data[key]} name={key} isLast={i === entries.length - 1} depth={depth + 1} />
              ))}
          <div className="leading-[22px]" style={{ paddingLeft: indent }}>
            <span className="text-th-text-3">{bracketClose}</span>
            {!isLast && <span className="text-th-text-3">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function isJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

export function JsonTree({ text }: { text: string }) {
  try {
    const parsed = JSON.parse(text);
    return (
      <div className="text-[12.5px] font-mono leading-relaxed">
        <JsonNode data={parsed} isLast depth={0} />
      </div>
    );
  } catch {
    return <span className="text-th-text-1">{text}</span>;
  }
}
```

- [ ] **Step 2: Update `ResponsePanel.tsx` to import instead of define**

Replace lines 1–135 of `src/components/ResponsePanel.tsx` (from the top of the file through the closing `}` of the local `JsonTree` function) with:

```tsx
import React, { useState, useEffect } from "react";
import { ResponseState } from "../types";
import { JsonTree, isJson } from "./JsonTree";

function StatusPill({ status, ok }: { status: number | null; ok: boolean }) {
  if (status == null) return null;
  const color = ok ? "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30" : "text-rose-400 bg-rose-400/10 ring-rose-400/30";
  return <span className={`px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 ${color}`}>{status}</span>;
}

function bytesToSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

Everything from `export default function ResponsePanel(...)` onward (the rest of the original file) stays exactly as it is — it already calls `isJson(...)` and `<JsonTree .../>`, which now resolve to the imported versions instead of local definitions.

- [ ] **Step 3: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit && npx vite build`
Expected: both succeed with no errors. `ResponsePanel.tsx` should render identically to before (pure refactor, no behavior change) — confirm by starting the app and opening any existing HTTP request's JSON response.

---

### Task 2: Add gRPC data model to `types.ts`

**Files:**
- Modify: `src/types.ts` (full-file rewrite — nearly every section changes)

**Interfaces:**
- Produces: `GrpcMethodType`, `GrpcRequestData`, `GrpcLogEntry`, `GrpcRequestNode`, `HttpTabState`, `GrpcTabState`, `TabState` (now a union), `defaultGrpcRequest(url?: string): GrpcRequestData`, `defaultMessageForMethodType(methodType: GrpcMethodType): string`. `TreeNode` becomes `FolderNode | RequestNode | GrpcRequestNode`. `FolderNode` gains optional `protoFiles?: { name: string; content: string }[]`.
- Consumes: nothing new (only existing `KVRow`, `uid`, `newRow`, `defaultRequest`).

This is the foundational task — every later task depends on these types existing.

- [ ] **Step 1: Replace the full contents of `src/types.ts`**

```typescript
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface KVRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
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
  protoFiles?: { name: string; content: string }[];
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
  tree: TreeNode[];
  variables: KVRow[];
  environments: Environment[];
  activeEnvironmentId: string | null;
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

export interface GrpcTabState {
  nodeId: string;
  kind: "grpc";
  draft: GrpcRequestData;
  dirty: boolean;
  log: GrpcLogEntry[];
  streaming: boolean;
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

export function demoWorkspace(): Workspace {
  return {
    variables: [newRow()],
    environments: [],
    activeEnvironmentId: null,
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
```

- [ ] **Step 2: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: **FAILS** at this point — `store.tsx`, `Sidebar.tsx`, `TabBar.tsx`, `App.tsx` all reference the now-changed `TabState`/`TreeNode` shapes and will show type errors (e.g. `Property 'method' does not exist on type 'RequestData | GrpcRequestData'`, `Property 'draft' does not exist on type 'HttpTabState | GrpcTabState'` where not narrowed). This is expected — those errors get fixed in Tasks 4, 9, 10, 11. Confirm the errors are ONLY in those four files (not in `postman.ts`, `useSendRequest.ts`, `pm.ts`, `RequestPanel.tsx`, `ResponsePanel.tsx`, `KeyValueEditor.tsx`, `CodeEditor.tsx`, `EnvironmentModal.tsx`) — those files only ever handle `kind === "request"`/`RequestData` shapes directly and must show zero new errors, since the spec's whole rationale for a separate `"grpc"` kind was to avoid touching them.

---

### Task 3: Mock gRPC catalog and call simulator

**Files:**
- Create: `src/lib/grpcMock.ts`

**Interfaces:**
- Consumes: `GrpcLogEntry`, `GrpcMethodType`, `GrpcRequestData`, `uid` from `"../types"` (Task 2).
- Produces: `GrpcServiceDef`, `GrpcMethodDef` (types), `MOCK_GRPC_SERVICES: GrpcServiceDef[]`, `findMockMethod(serviceName, methodName): GrpcMethodDef | null`, `simulateGrpcCall(req: GrpcRequestData, onChunk: (entry: GrpcLogEntry) => void, isCancelled: () => boolean): Promise<void>`. Task 4 (`store.tsx`) calls `simulateGrpcCall`; Task 6 (`GrpcServicePicker.tsx`) and Task 8 (`GrpcPanel.tsx`) use `MOCK_GRPC_SERVICES`.

Two mock services covering all four method types: `helloworld.Greeter` (unary + server-stream) and `chat.ChatService` (client-stream + bidi).

- [ ] **Step 1: Create `src/lib/grpcMock.ts`**

```typescript
import { GrpcLogEntry, GrpcMethodType, GrpcRequestData, uid } from "../types";

export interface GrpcMethodDef {
  name: string;
  methodType: GrpcMethodType;
  requestExample: string;
}

export interface GrpcServiceDef {
  name: string;
  methods: GrpcMethodDef[];
}

export const MOCK_GRPC_SERVICES: GrpcServiceDef[] = [
  {
    name: "helloworld.Greeter",
    methods: [
      { name: "SayHello", methodType: "unary", requestExample: '{\n  "name": "Relay"\n}' },
      { name: "SayHelloStream", methodType: "server-stream", requestExample: '{\n  "name": "Relay"\n}' },
    ],
  },
  {
    name: "chat.ChatService",
    methods: [
      {
        name: "SendMessages",
        methodType: "client-stream",
        requestExample: '[\n  { "user": "alice", "text": "hi" },\n  { "user": "alice", "text": "how are you?" }\n]',
      },
      {
        name: "Chat",
        methodType: "bidi",
        requestExample: '[\n  { "user": "alice", "text": "hi" },\n  { "user": "alice", "text": "still there?" }\n]',
      },
    ],
  },
];

export function findMockMethod(serviceName: string, methodName: string): GrpcMethodDef | null {
  const service = MOCK_GRPC_SERVICES.find((s) => s.name === serviceName);
  return service?.methods.find((m) => m.name === methodName) ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockReplyFor(method: string, sentJson: any): any {
  if (method === "SayHello" || method === "SayHelloStream") {
    const name = typeof sentJson?.name === "string" ? sentJson.name : "world";
    return { message: `Hello, ${name}!` };
  }
  if (method === "SendMessages") {
    return { count: Array.isArray(sentJson) ? sentJson.length : 0 };
  }
  return { echo: sentJson };
}

export async function simulateGrpcCall(
  req: GrpcRequestData,
  onChunk: (entry: GrpcLogEntry) => void,
  isCancelled: () => boolean
): Promise<void> {
  let parsed: any;
  try {
    parsed = JSON.parse(req.messageJson);
  } catch (e: any) {
    onChunk({ id: uid(), timestamp: Date.now(), direction: "error", json: `Invalid JSON message: ${e.message}` });
    return;
  }

  if (req.methodType === "unary") {
    onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(parsed, null, 2) });
    await wait(400);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify(mockReplyFor(req.method, parsed), null, 2) });
    return;
  }

  if (req.methodType === "server-stream") {
    onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(parsed, null, 2) });
    for (let i = 1; i <= 3; i++) {
      await wait(350);
      if (isCancelled()) return;
      const reply = mockReplyFor(req.method, parsed);
      onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify({ ...reply, seq: i }, null, 2) });
    }
    return;
  }

  const messages: any[] = Array.isArray(parsed) ? parsed : [parsed];

  if (req.methodType === "client-stream") {
    for (const msg of messages) {
      await wait(250);
      if (isCancelled()) return;
      onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(msg, null, 2) });
    }
    await wait(300);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify(mockReplyFor(req.method, messages), null, 2) });
    return;
  }

  // bidi
  for (const msg of messages) {
    await wait(250);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "sent", json: JSON.stringify(msg, null, 2) });
    await wait(250);
    if (isCancelled()) return;
    onChunk({ id: uid(), timestamp: Date.now(), direction: "received", json: JSON.stringify(mockReplyFor(req.method, msg), null, 2) });
  }
}
```

`isCancelled` exists so `sendGrpcTab` (Task 4) can stop appending chunks if the tab is closed mid-stream — Phase 2's real streaming will need the same cancellation shape, so this keeps the mock a close stand-in for the eventual real implementation.

- [ ] **Step 2: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: no NEW errors introduced by this file itself (the pre-existing Task 2 errors in `store.tsx`/`Sidebar.tsx`/`TabBar.tsx`/`App.tsx` are still expected at this point).

---

### Task 4: Wire gRPC tabs into `store.tsx`

**Files:**
- Modify: `src/store.tsx`

**Interfaces:**
- Consumes: `defaultGrpcRequest`, `GrpcRequestData`, `GrpcRequestNode`, `GrpcTabState`, `HttpTabState` from `"./types"` (Task 2); `simulateGrpcCall` from `"./lib/grpcMock"` (Task 3).
- Produces (added to the `Ctx` interface / provider value, consumed by Task 9, 10, 11): `addGrpcRequest(parentId: string | null): string`, `updateGrpcDraft(id: string, patch: Partial<GrpcRequestData>): void`, `sendGrpcTab(id: string): Promise<void>`.

- [ ] **Step 1: Update imports (replace lines 1–5)**

```typescript
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Environment, FolderNode, GrpcRequestData, GrpcRequestNode, GrpcTabState, HttpTabState, KVRow, RequestData, RequestNode, TabState, TreeNode, Workspace, defaultGrpcRequest, defaultRequest, demoWorkspace, newRow, uid } from "./types";
import { loadWorkspaceFile, saveWorkspaceFile, pickJsonFile, pickSavePath, readFileAtPath, writeFileAtPath } from "./lib/tauri";
import { runRequest } from "./lib/useSendRequest";
import { isPostmanCollection, isRelayWorkspace, postmanToTree, treeToPostman } from "./lib/postman";
import { simulateGrpcCall } from "./lib/grpcMock";
```

- [ ] **Step 2: Add three members to the `Ctx` interface**

In the `Ctx` interface (starts at `interface Ctx {`), add these three lines anywhere among the other action declarations, before the interface's closing `}`:

```typescript
  addGrpcRequest: (parentId: string | null) => string;
  updateGrpcDraft: (id: string, patch: Partial<GrpcRequestData>) => void;
  sendGrpcTab: (id: string) => Promise<void>;
```

- [ ] **Step 3: Add a cancellation-ref map near the top of `WorkspaceProvider`**

Immediately after `const loaded = useRef(false);` (inside `WorkspaceProvider`, right after the four `useState` declarations), add:

```typescript
  const grpcCancelRefs = useRef<Map<string, { current: boolean }>>(new Map());
```

- [ ] **Step 4: Add `addGrpcRequest`, right after the existing `addRequest` callback**

```typescript
  const addGrpcRequest = useCallback((parentId: string | null) => {
    const node: GrpcRequestNode = { id: uid(), kind: "grpc", name: "New gRPC Request", request: defaultGrpcRequest() };
    setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, node) }));
    return node.id;
  }, []);
```

- [ ] **Step 5: Replace `openTab` to construct the right tab shape per node kind**

Replace the existing `openTab` callback entirely with:

```typescript
  const openTab = useCallback(
    (id: string) => {
      const node = findNode(workspace.tree, id);
      if (!node || node.kind === "folder") return;
      setTabs((t) => {
        if (t.some((tab) => tab.nodeId === id)) return t;
        if (node.kind === "grpc") {
          const tab: GrpcTabState = {
            nodeId: id,
            kind: "grpc",
            draft: JSON.parse(JSON.stringify(node.request)),
            dirty: false,
            log: [],
            streaming: false,
          };
          return [...t, tab];
        }
        const tab: HttpTabState = {
          nodeId: id,
          kind: "http",
          draft: JSON.parse(JSON.stringify(node.request)),
          dirty: false,
          response: null,
          loading: false,
        };
        return [...t, tab];
      });
      setActiveTabId(id);
    },
    [workspace.tree]
  );
```

- [ ] **Step 6: Add cancellation to `forceCloseTab`**

In the existing `forceCloseTab` callback, add cancellation at the very start of the function body (before `const idx = ...`):

```typescript
      const cancelRef = grpcCancelRefs.current.get(id);
      if (cancelRef) {
        cancelRef.current = true;
        grpcCancelRefs.current.delete(id);
      }
```

- [ ] **Step 7: Narrow `updateDraft` to HTTP tabs, add `updateGrpcDraft`**

Replace the existing `updateDraft` callback with:

```typescript
  const updateDraft = useCallback((id: string, patch: Partial<RequestData>) => {
    setTabs((t) => t.map((tab) => (tab.nodeId === id && tab.kind === "http" ? { ...tab, draft: { ...tab.draft, ...patch }, dirty: true } : tab)));
  }, []);

  const updateGrpcDraft = useCallback((id: string, patch: Partial<GrpcRequestData>) => {
    setTabs((t) => t.map((tab) => (tab.nodeId === id && tab.kind === "grpc" ? { ...tab, draft: { ...tab.draft, ...patch }, dirty: true } : tab)));
  }, []);
```

- [ ] **Step 8: Update `saveTab`'s tree-mapper to handle both kinds**

Replace the `mapTree` call inside `saveTab` with:

```typescript
      setWorkspace((ws) => ({
        ...ws,
        tree: mapTree(ws.tree, id, (n) => {
          if (n.kind === "request" && tab.kind === "http") return { ...n, request: tab.draft };
          if (n.kind === "grpc" && tab.kind === "grpc") return { ...n, request: tab.draft };
          return n;
        }),
      }));
```

(The rest of `saveTab` — finding `tab`, returning the updated tabs array — stays unchanged.)

- [ ] **Step 9: Add `sendGrpcTab`, right after the existing `sendTab` callback**

```typescript
  const sendGrpcTab = useCallback(
    async (id: string) => {
      const cancelRef = { current: false };
      grpcCancelRefs.current.set(id, cancelRef);
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, streaming: true, log: [] } : x)));
      const tab = tabs.find((t) => t.nodeId === id);
      if (!tab || tab.kind !== "grpc") return;
      await simulateGrpcCall(
        tab.draft,
        (entry) => {
          if (cancelRef.current) return;
          setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, log: [...x.log, entry] } : x)));
        },
        () => cancelRef.current
      );
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, streaming: false } : x)));
    },
    [tabs]
  );
```

- [ ] **Step 10: Add the three new members to the provider's `value` object and its dependency array**

In the `value = useMemo<Ctx>(...)` block, add `addGrpcRequest,` right after `addRequest,`, add `updateGrpcDraft,` right after `updateDraft,`, and add `sendGrpcTab,` right after `sendTab,` — in both the returned object literal and the dependency array that follows it.

- [ ] **Step 11: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: `store.tsx` itself now compiles clean. Errors should remain only in `Sidebar.tsx`, `TabBar.tsx`, `App.tsx` (fixed in later tasks).

---

### Task 5: Skip gRPC requests on Postman export, with a visible notice

**Files:**
- Modify: `src/lib/postman.ts:122-179`
- Modify: `src/store.tsx` (the `exportCollection` callback and its `Ctx` interface entry)
- Modify: `src/components/SettingsModal.tsx` (the `handleExport` function)

**Interfaces:**
- Produces: `treeToPostman(tree, name): { collection: PostmanCollection; skippedGrpcCount: number }` (signature change — was `treeToPostman(tree, name): PostmanCollection`). `exportCollection(): Promise<{ skippedGrpcCount: number } | null>` (signature change — was `Promise<void>`).

Per the spec: Postman's own app cannot export gRPC requests (confirmed via postmanlabs/postman-app-support#11579 and #11252) — there is no schema to match, so gRPC nodes are filtered out of the export with a user-visible count of how many were skipped and why.

- [ ] **Step 1: Update `treeNodeToPostmanItem` and `treeToPostman` in `src/lib/postman.ts`**

Replace `treeNodeToPostmanItem` (currently starting `function treeNodeToPostmanItem(node: TreeNode): PostmanItem {`) with:

```typescript
function treeNodeToPostmanItem(node: TreeNode): PostmanItem | null {
  if (node.kind === "folder") {
    const children = node.children.map(treeNodeToPostmanItem).filter((x): x is PostmanItem => x !== null);
    return {
      name: node.name,
      item: children,
    };
  }

  if (node.kind === "grpc") return null;

  const req = node.request;
  const headers: PostmanHeader[] = req.headers
    .filter((h) => h.key.trim())
    .map((h) => ({ key: h.key, value: h.value, ...(h.enabled ? {} : { disabled: true }) }));

  let body: PostmanBody | undefined;
  if (req.bodyMode === "json") {
    body = { mode: "raw", raw: req.bodyText, options: { raw: { language: "json" } } };
  } else if (req.bodyMode === "text") {
    body = { mode: "raw", raw: req.bodyText };
  }

  const urlObj: PostmanUrl = { raw: req.url };
  try {
    const parsed = new URL(req.url.replace(/\{\{[^}]*\}\}/g, "placeholder"));
    urlObj.protocol = parsed.protocol.replace(":", "");
    urlObj.host = parsed.hostname.split(".");
    urlObj.path = parsed.pathname.split("/").filter(Boolean);
  } catch {}

  const queryParams = req.params.filter((p) => p.enabled && p.key.trim());
  if (queryParams.length > 0) {
    urlObj.query = queryParams.map((p) => ({
      key: p.key,
      value: p.value,
      ...(p.enabled ? {} : { disabled: true }),
    }));
  }

  return {
    name: node.name,
    request: {
      method: req.method,
      header: headers.length > 0 ? headers : undefined,
      body,
      url: urlObj,
    },
  };
}
```

Replace `treeToPostman` (currently `export function treeToPostman(tree: TreeNode[], name: string): PostmanCollection {`) with:

```typescript
function countGrpcNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.kind === "grpc" ? 1 : n.kind === "folder" ? countGrpcNodes(n.children) : 0), 0);
}

export function treeToPostman(tree: TreeNode[], name: string): { collection: PostmanCollection; skippedGrpcCount: number } {
  const skippedGrpcCount = countGrpcNodes(tree);
  const item = tree.map(treeNodeToPostmanItem).filter((x): x is PostmanItem => x !== null);
  return {
    collection: {
      info: {
        name,
        _postman_id: uid(),
        schema: POSTMAN_SCHEMA,
      },
      item,
    },
    skippedGrpcCount,
  };
}
```

- [ ] **Step 2: Update `exportCollection` in `src/store.tsx`**

Replace the existing `exportCollection` callback with:

```typescript
  const exportCollection = useCallback(async (): Promise<{ skippedGrpcCount: number } | null> => {
    const path = await pickSavePath("collection.json");
    if (!path) return null;
    const { collection, skippedGrpcCount } = treeToPostman(workspace.tree, "Relay Collection");
    await writeFileAtPath(path, JSON.stringify(collection, null, 2));
    return { skippedGrpcCount };
  }, [workspace.tree]);
```

Update the `Ctx` interface's existing `exportCollection` line from `exportCollection: () => Promise<void>;` to `exportCollection: () => Promise<{ skippedGrpcCount: number } | null>;`.

- [ ] **Step 3: Update `handleExport` in `src/components/SettingsModal.tsx`**

Replace the existing `handleExport` function with:

```typescript
  const handleExport = async () => {
    try {
      const result = await exportCollection();
      if (!result) return;
      if (result.skippedGrpcCount > 0) {
        setStatus(
          `Collection exported. ${result.skippedGrpcCount} gRPC request${result.skippedGrpcCount === 1 ? "" : "s"} skipped — Postman does not support gRPC in collection exports.`
        );
      } else {
        setStatus("Collection exported.");
      }
    } catch (e: any) {
      setStatus(`Export failed: ${e.message || e}`);
    }
  };
```

- [ ] **Step 4: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit && npx vite build`
Expected: both succeed. Manually verify: create a gRPC request (once Task 11 is done — if running tasks in order, come back to re-check this after Task 11), export the collection from Settings, confirm the status message reports the skipped count and the written JSON file contains no `"grpc"`-kind data.

---

### Task 6: `GrpcServicePicker` component

**Files:**
- Create: `src/components/GrpcServicePicker.tsx`

**Interfaces:**
- Consumes: `GrpcMethodType` from `"../types"`; `GrpcServiceDef` from `"../lib/grpcMock"` (Task 3).
- Produces: default-exported `GrpcServicePicker({ services, selectedService, selectedMethod, onSelect })` where `onSelect: (service: string, method: string, methodType: GrpcMethodType) => void`. Consumed by `GrpcPanel.tsx` (Task 8).

- [ ] **Step 1: Create `src/components/GrpcServicePicker.tsx`**

```tsx
import React, { useMemo, useState } from "react";
import { GrpcMethodType } from "../types";
import { GrpcServiceDef } from "../lib/grpcMock";

const METHOD_TYPE_LABEL: Record<GrpcMethodType, string> = {
  unary: "unary",
  "server-stream": "server stream",
  "client-stream": "client stream",
  bidi: "bidi stream",
};

interface Props {
  services: GrpcServiceDef[];
  selectedService: string;
  selectedMethod: string;
  onSelect: (service: string, method: string, methodType: GrpcMethodType) => void;
}

export default function GrpcServicePicker({ services, selectedService, selectedMethod, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services
      .map((s) => ({ ...s, methods: s.methods.filter((m) => `${s.name}.${m.name}`.toLowerCase().includes(q)) }))
      .filter((s) => s.methods.length > 0);
  }, [services, query]);

  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search service or method"
        className="bg-th-bg border border-th-border-input rounded-md px-3 py-1.5 text-[12.5px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
      />
      <div className="flex flex-col gap-3">
        {filtered.map((service) => (
          <div key={service.name}>
            <div className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1">{service.name}</div>
            <div className="flex flex-col gap-0.5">
              {service.methods.map((m) => {
                const active = selectedService === service.name && selectedMethod === m.name;
                return (
                  <button
                    key={m.name}
                    onClick={() => onSelect(service.name, m.name, m.methodType)}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-left transition-colors ${
                      active ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-1 hover:bg-th-hover"
                    }`}
                  >
                    <span className="font-mono">{m.name}</span>
                    <span className="text-[10.5px] font-mono text-th-text-3 shrink-0">{METHOD_TYPE_LABEL[m.methodType]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <span className="text-[12px] text-th-text-4 font-mono">no matches</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: no new errors (this component isn't imported anywhere yet, so it only needs to type-check standalone).

---

### Task 7: `GrpcResponseLog` component

**Files:**
- Create: `src/components/GrpcResponseLog.tsx`

**Interfaces:**
- Consumes: `GrpcLogEntry` from `"../types"`; `JsonTree`, `isJson` from `"./JsonTree"` (Task 1).
- Produces: default-exported `GrpcResponseLog({ log, streaming }: { log: GrpcLogEntry[]; streaming: boolean })`. Consumed by `App.tsx` (Task 10).

- [ ] **Step 1: Create `src/components/GrpcResponseLog.tsx`**

```tsx
import React from "react";
import { GrpcLogEntry } from "../types";
import { JsonTree, isJson } from "./JsonTree";

function DirectionBadge({ direction }: { direction: GrpcLogEntry["direction"] }) {
  if (direction === "sent") {
    return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-th-accent-text bg-th-accent-bg">SENT</span>;
  }
  if (direction === "error") {
    return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-rose-400 bg-rose-400/10">ERROR</span>;
  }
  return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-emerald-400 bg-emerald-400/10">RECV</span>;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function GrpcResponseLog({ log, streaming }: { log: GrpcLogEntry[]; streaming: boolean }) {
  if (log.length === 0 && !streaming) {
    return (
      <div className="h-full grid place-items-center text-th-text-4 text-[13px] font-mono">
        response will appear here
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 flex items-center gap-3 text-[12.5px] font-mono shrink-0">
        {streaming ? (
          <span className="text-th-text-3">streaming…</span>
        ) : (
          <span className="text-th-text-2">{log.length} message{log.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 flex flex-col gap-3">
        {log.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <DirectionBadge direction={entry.direction} />
              <span className="text-[11px] font-mono text-th-text-4">{formatTime(entry.timestamp)}</span>
            </div>
            {entry.direction === "error" ? (
              <p className="text-[12.5px] font-mono text-rose-300 leading-relaxed">{entry.json}</p>
            ) : isJson(entry.json) ? (
              <JsonTree text={entry.json} />
            ) : (
              <pre className="text-[12.5px] font-mono text-th-text-1 whitespace-pre-wrap">{entry.json}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: no new errors.

---

### Task 8: `GrpcPanel` component

**Files:**
- Create: `src/components/GrpcPanel.tsx`

**Interfaces:**
- Consumes: `GrpcRequestData`, `GrpcMethodType`, `defaultMessageForMethodType` from `"../types"` (Task 2); `MOCK_GRPC_SERVICES` from `"../lib/grpcMock"` (Task 3); `CodeEditor` from `"./CodeEditor"`; `KeyValueEditor` from `"./KeyValueEditor"`; `GrpcServicePicker` from `"./GrpcServicePicker"` (Task 6).
- Produces: default-exported `GrpcPanel({ draft, streaming, onChange, onSend })` where `onChange: (patch: Partial<GrpcRequestData>) => void`, `onSend: () => void`. Consumed by `App.tsx` (Task 10).

- [ ] **Step 1: Create `src/components/GrpcPanel.tsx`**

```tsx
import React, { useState } from "react";
import { GrpcRequestData, GrpcMethodType, defaultMessageForMethodType } from "../types";
import { MOCK_GRPC_SERVICES } from "../lib/grpcMock";
import CodeEditor from "./CodeEditor";
import KeyValueEditor from "./KeyValueEditor";
import GrpcServicePicker from "./GrpcServicePicker";

const METHOD_TYPE_BADGE: Record<GrpcMethodType, string> = {
  unary: "unary",
  "server-stream": "server-stream",
  "client-stream": "client-stream",
  bidi: "bidi",
};

interface Props {
  draft: GrpcRequestData;
  streaming: boolean;
  onChange: (patch: Partial<GrpcRequestData>) => void;
  onSend: () => void;
}

export default function GrpcPanel({ draft, streaming, onChange, onSend }: Props) {
  const [tab, setTab] = useState<"service" | "message" | "metadata" | "settings">("service");

  const messagePlaceholder =
    draft.methodType === "client-stream" || draft.methodType === "bidi"
      ? '[\n  { "field": "value" }\n]'
      : '{\n  "field": "value"\n}';

  const enabledMetadataCount = draft.metadata.filter((m) => m.enabled && m.key.trim()).length;

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 flex items-center gap-2">
        <div className="relative flex-1 min-w-0 bg-th-surface border border-th-border-input rounded-md">
          <input
            value={draft.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="grpc://localhost:50051"
            spellCheck={false}
            className="w-full px-3 py-2 text-[13px] font-mono bg-transparent text-th-text-1 placeholder:text-th-text-4 focus:outline-none"
          />
        </div>
        {draft.method && (
          <span className="px-2.5 py-2 rounded-md text-[12px] font-mono font-semibold text-th-accent-text bg-th-accent-bg shrink-0">
            {draft.service}.{draft.method}
          </span>
        )}
        <button
          onClick={onSend}
          disabled={streaming || !draft.method}
          className="px-4 py-2 rounded-md text-[13px] font-semibold border border-transparent bg-th-accent text-white hover:bg-th-accent-hover transition-colors shrink-0 disabled:opacity-60"
        >
          {streaming ? "Streaming…" : "Send"}
        </button>
      </div>

      <div className="px-4 mt-4">
        <div className="flex items-center gap-4 border-b border-th-border text-[12.5px] font-mono overflow-x-auto overflow-y-hidden">
          {(
            [
              ["service", "Service"],
              ["message", "Message"],
              ["metadata", `Metadata${enabledMetadataCount ? ` (${enabledMetadataCount})` : ""}`],
              ["settings", "Settings"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-2 -mb-px border-b-2 whitespace-nowrap transition-colors ${
                tab === key ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        {tab === "service" && (
          <GrpcServicePicker
            services={MOCK_GRPC_SERVICES}
            selectedService={draft.service}
            selectedMethod={draft.method}
            onSelect={(service, method, methodType) =>
              onChange({ service, method, methodType, messageJson: defaultMessageForMethodType(methodType) })
            }
          />
        )}
        {tab === "message" && (
          <div className="flex flex-col gap-1.5">
            <CodeEditor
              value={draft.messageJson}
              onChange={(v) => onChange({ messageJson: v })}
              placeholder={messagePlaceholder}
              className="h-48 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
            />
            <span className="text-[11px] text-th-text-4 font-mono">
              {draft.methodType === "client-stream" || draft.methodType === "bidi"
                ? "JSON array — every element sent in sequence when you hit Send"
                : "single JSON object"}
              {draft.method && ` · ${METHOD_TYPE_BADGE[draft.methodType]}`}
            </span>
          </div>
        )}
        {tab === "metadata" && (
          <KeyValueEditor rows={draft.metadata} onChangeRows={(rows) => onChange({ metadata: rows })} placeholderKey="metadata key" placeholderVal="value" />
        )}
        {tab === "settings" && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide">Service discovery</span>
            <div className="flex gap-1.5">
              {(["reflection", "imported"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onChange({ protoSource: mode })}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-mono ring-1 transition-colors ${
                    draft.protoSource === mode ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
                  }`}
                >
                  {mode === "reflection" ? "Server reflection" : "Imported .proto"}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-th-text-4 font-mono">
              {draft.protoSource === "reflection"
                ? "queries the server's reflection API for available services"
                : "uses .proto files attached to this request's collection folder"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: the Settings tab's proto-source toggle only stores the preference in Phase 1 — it does not change what shows in the Service tab (which always shows the static mock catalog regardless of mode), and there is no file upload/paste UI yet. Real proto import parsing is Phase 2 work (needs the Rust `protox` compiler); building a fake upload flow with nothing real behind it now would be YAGNI.

- [ ] **Step 2: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: no new errors.

---

### Task 9: `TabBar.tsx` — kind-aware tab badge

**Files:**
- Modify: `src/components/TabBar.tsx:66-71`

**Interfaces:**
- Consumes: `tab.kind` (from the `TabState` union, Task 2) — no new exports.

- [ ] **Step 1: Replace the tab title/badge block**

Replace:

```tsx
            title={`${tab.draft.method} ${nameFor(tab.nodeId)}\n${tab.draft.url || "(no URL)"}`}
            className={`group flex items-center gap-2 px-3 py-2 border-r border-th-border cursor-pointer text-[12.5px] whitespace-nowrap ${
              active ? "bg-th-surface text-th-text-1" : "text-th-text-3 hover:text-th-text-1"
            }`}
          >
            <span className={`font-mono text-[10.5px] font-bold ${METHOD_COLOR[tab.draft.method]}`}>{tab.draft.method}</span>
```

with:

```tsx
            title={`${tab.kind === "grpc" ? "gRPC" : tab.draft.method} ${nameFor(tab.nodeId)}\n${tab.draft.url || "(no URL)"}`}
            className={`group flex items-center gap-2 px-3 py-2 border-r border-th-border cursor-pointer text-[12.5px] whitespace-nowrap ${
              active ? "bg-th-surface text-th-text-1" : "text-th-text-3 hover:text-th-text-1"
            }`}
          >
            {tab.kind === "grpc" ? (
              <span className="font-mono text-[10.5px] font-bold text-th-accent-text">gRPC</span>
            ) : (
              <span className={`font-mono text-[10.5px] font-bold ${METHOD_COLOR[tab.draft.method]}`}>{tab.draft.method}</span>
            )}
```

Nothing else in `TabBar.tsx` changes — `tab.nodeId`, `tab.dirty` are common fields on both `HttpTabState` and `GrpcTabState`.

- [ ] **Step 2: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: `TabBar.tsx` now compiles clean. Remaining errors only in `App.tsx`, `Sidebar.tsx`.

---

### Task 10: `App.tsx` — mount the right panel pair per tab kind

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `GrpcPanel` (Task 8), `GrpcResponseLog` (Task 7), `updateGrpcDraft`/`sendGrpcTab` from `useWorkspace()` (Task 4).

- [ ] **Step 1: Add imports**

Add after the existing `import ResponsePanel from "./components/ResponsePanel";` line:

```typescript
import GrpcPanel from "./components/GrpcPanel";
import GrpcResponseLog from "./components/GrpcResponseLog";
```

- [ ] **Step 2: Pull the new store functions into `Main`**

Replace:

```typescript
  const { tabs, activeTabId, updateDraft, saveTab, sendTab } = useWorkspace();
```

with:

```typescript
  const { tabs, activeTabId, updateDraft, saveTab, sendTab, updateGrpcDraft, sendGrpcTab } = useWorkspace();
```

- [ ] **Step 3: Add two render-helper functions, right before the `return (` of `Main`**

```typescript
  const renderTopPanel = () => {
    if (!activeTab) return null;
    if (activeTab.kind === "grpc") {
      return (
        <GrpcPanel
          draft={activeTab.draft}
          streaming={activeTab.streaming}
          onChange={(patch) => updateGrpcDraft(activeTab.nodeId, patch)}
          onSend={() => sendGrpcTab(activeTab.nodeId)}
        />
      );
    }
    return (
      <RequestPanel
        draft={activeTab.draft}
        loading={activeTab.loading}
        dirty={activeTab.dirty}
        onChange={(patch) => updateDraft(activeTab.nodeId, patch)}
        onSend={() => sendTab(activeTab.nodeId)}
        onSave={() => saveTab(activeTab.nodeId)}
      />
    );
  };

  const renderBottomPanel = () => {
    if (!activeTab) return null;
    if (activeTab.kind === "grpc") {
      return <GrpcResponseLog log={activeTab.log} streaming={activeTab.streaming} />;
    }
    return <ResponsePanel response={activeTab.response} loading={activeTab.loading} />;
  };
```

- [ ] **Step 4: Replace both panel-rendering blocks inside the `responseLayout === "side" ? (...) : (...)` JSX**

Replace the `"side"` branch's inner content:

```tsx
                <div className="overflow-y-auto overflow-x-hidden min-h-0 shrink-0" style={{ width: splitWidth }}>
                  <RequestPanel
                    draft={activeTab.draft}
                    loading={activeTab.loading}
                    dirty={activeTab.dirty}
                    onChange={(patch) => updateDraft(activeTab.nodeId, patch)}
                    onSend={() => sendTab(activeTab.nodeId)}
                    onSave={() => saveTab(activeTab.nodeId)}
                  />
                </div>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setResizingWidth(true); }}
                  className={`w-1 shrink-0 cursor-col-resize hover:bg-th-accent-border ${resizingWidth ? "bg-th-accent-border" : "bg-th-border"}`}
                />
                <div className="flex-1 min-w-0 min-h-0">
                  <ResponsePanel response={activeTab.response} loading={activeTab.loading} />
                </div>
```

with:

```tsx
                <div className="overflow-y-auto overflow-x-hidden min-h-0 shrink-0" style={{ width: splitWidth }}>
                  {renderTopPanel()}
                </div>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setResizingWidth(true); }}
                  className={`w-1 shrink-0 cursor-col-resize hover:bg-th-accent-border ${resizingWidth ? "bg-th-accent-border" : "bg-th-border"}`}
                />
                <div className="flex-1 min-w-0 min-h-0">
                  {renderBottomPanel()}
                </div>
```

Replace the `"bottom"` branch's inner content (the `else` side of the ternary):

```tsx
                <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
                  <RequestPanel
                    draft={activeTab.draft}
                    loading={activeTab.loading}
                    dirty={activeTab.dirty}
                    onChange={(patch) => updateDraft(activeTab.nodeId, patch)}
                    onSend={() => sendTab(activeTab.nodeId)}
                    onSave={() => saveTab(activeTab.nodeId)}
                  />
                </div>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setResizingHeight(true); }}
                  className={`h-1 shrink-0 cursor-row-resize hover:bg-th-accent-border ${resizingHeight ? "bg-th-accent-border" : "bg-th-border"}`}
                />
                <div className="shrink-0 min-h-0" style={{ height: splitHeight }}>
                  <ResponsePanel response={activeTab.response} loading={activeTab.loading} />
                </div>
```

with:

```tsx
                <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
                  {renderTopPanel()}
                </div>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setResizingHeight(true); }}
                  className={`h-1 shrink-0 cursor-row-resize hover:bg-th-accent-border ${resizingHeight ? "bg-th-accent-border" : "bg-th-border"}`}
                />
                <div className="shrink-0 min-h-0" style={{ height: splitHeight }}>
                  {renderBottomPanel()}
                </div>
```

The resize drag logic (`resizingWidth`/`resizingHeight`/`splitWidth`/`splitHeight` state and their `useEffect`s) is untouched — both layout modes keep working identically for gRPC tabs as they already do for HTTP tabs.

- [ ] **Step 2: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit`
Expected: `App.tsx` now compiles clean. Remaining errors only in `Sidebar.tsx`.

---

### Task 11: `Sidebar.tsx` — create and display gRPC requests

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `addGrpcRequest` from `useWorkspace()` (Task 4).
- Produces: a new local `AddRequestDropdown` component (not exported outside this file — used at three call sites within `Sidebar.tsx`).

- [ ] **Step 1: Widen `CtxMenuState.kind`**

Replace:

```typescript
interface CtxMenuState {
  x: number;
  y: number;
  nodeId: string;
  kind: "folder" | "request";
}
```

with:

```typescript
interface CtxMenuState {
  x: number;
  y: number;
  nodeId: string;
  kind: "folder" | "request" | "grpc";
}
```

- [ ] **Step 2: Add the `AddRequestDropdown` helper component**

Add this new function right after `FolderIcon` and before `interface CtxMenuState`:

```tsx
function AddRequestDropdown({ title, onAddHttp, onAddGrpc, className }: {
  title: string;
  onAddHttp: () => void;
  onAddGrpc: () => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button title={title} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className={className}>
        +
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[160px]">
          <button
            onClick={(e) => { e.stopPropagation(); onAddHttp(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            HTTP Request
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddGrpc(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            gRPC Request
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add `addGrpcRequest` to `TreeItem`'s destructure**

Replace:

```typescript
  const { addFolder, addRequest, renameNode, toggleCollapse, openTab, activeTabId, tabs } = useWorkspace();
```

with:

```typescript
  const { addFolder, addRequest, addGrpcRequest, renameNode, toggleCollapse, openTab, activeTabId, tabs } = useWorkspace();
```

- [ ] **Step 4: Replace the folder row's hover "+" button with the dropdown**

Inside the `if (node.kind === "folder")` block, replace:

```tsx
              <button
                title="New request"
                onClick={(e) => { e.stopPropagation(); addRequest(node.id); }}
                className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
              >
                +
              </button>
```

with:

```tsx
              <AddRequestDropdown
                title="New request"
                onAddHttp={() => addRequest(node.id)}
                onAddGrpc={() => addGrpcRequest(node.id)}
                className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
              />
```

- [ ] **Step 5: Add a `"grpc"` row branch in `TreeItem`, right after the folder block's closing `}` and before the existing `const isOpen = ...` lines**

Move the three lines:

```typescript
  const isOpen = tabs.some((t) => t.nodeId === node.id);
  const isActive = activeTabId === node.id;
  const isDirty = tabs.find((t) => t.nodeId === node.id)?.dirty;
```

so they appear immediately after the folder block's closing `}` (before any kind-specific branch), then insert this new branch right after them, before the existing HTTP request-row `return (...)`:

```tsx
  if (node.kind === "grpc") {
    return (
      <div
        data-tree-id={node.id}
        data-tree-kind="grpc"
        onMouseDown={handleMouseDown}
        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] ${
          isDragging ? "opacity-30" : "opacity-100"
        } ${
          isActive && !isDropTarget ? "bg-th-accent-bg" : !isDropTarget ? "hover:bg-th-hover" : ""
        } ${
          dropPos === "before" ? "border-t-2 border-th-accent" : ""
        } ${
          dropPos === "after" ? "border-b-2 border-th-accent" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => { if (suppressNextClick) return; openTab(node.id); }}
        onContextMenu={(e) => onCtxMenu(e, node)}
      >
        <span className="font-mono text-[9.5px] font-bold w-9 shrink-0 text-th-accent-text">gRPC</span>
        {editing ? (
          <input
            autoFocus
            value={editVal}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditing(false); setEditVal(node.name); }
            }}
            className="flex-1 bg-th-surface border border-th-accent-border rounded px-1 py-0.5 text-th-text-1 text-[13px] focus:outline-none"
          />
        ) : (
          <span
            className={`flex-1 truncate ${isActive || isOpen ? "text-th-text-1" : "text-th-text-2"}`}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {node.name}
          </span>
        )}
        {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
        {hover && !editing && (
          <button
            title="Delete"
            onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
            className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10 shrink-0"
          >
            ×
          </button>
        )}
      </div>
    );
  }
```

The existing HTTP request-row `return (...)` block that follows stays exactly as it is.

- [ ] **Step 6: Add `addGrpcRequest` to `Sidebar`'s destructure**

Replace:

```typescript
  const { workspace, addFolder, addRequest, deleteNode, moveNode } = useWorkspace();
```

with:

```typescript
  const { workspace, addFolder, addRequest, addGrpcRequest, deleteNode, moveNode } = useWorkspace();
```

- [ ] **Step 7: Replace the toolbar's "+" button with the dropdown**

Replace:

```tsx
          <button
            title="New request"
            onClick={() => {
              const id = addRequest(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg text-[13px]"
          >
            +
          </button>
```

with:

```tsx
          <AddRequestDropdown
            title="New request"
            onAddHttp={() => {
              const id = addRequest(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            onAddGrpc={() => {
              const id = addGrpcRequest(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg text-[13px]"
          />
```

- [ ] **Step 8: Add a "New gRPC Request" option to the context menu**

Replace:

```tsx
          {ctxMenu.kind === "folder" && (
            <>
              <button
                onClick={() => {
                  const id = addRequest(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New Request
              </button>
              <button
                onClick={() => {
                  const id = addFolder(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New Folder
              </button>
              <div className="my-1 border-t border-th-border" />
            </>
          )}
```

with:

```tsx
          {ctxMenu.kind === "folder" && (
            <>
              <button
                onClick={() => {
                  const id = addRequest(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New HTTP Request
              </button>
              <button
                onClick={() => {
                  const id = addGrpcRequest(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New gRPC Request
              </button>
              <button
                onClick={() => {
                  const id = addFolder(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New Folder
              </button>
              <div className="my-1 border-t border-th-border" />
            </>
          )}
```

- [ ] **Step 9: Verify**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit && npx vite build`
Expected: both succeed with **zero** errors anywhere in the project — this was the last file with pending errors from Task 2.

---

### Task 12: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Full type-check and build**

Run: `cd "/Users/muhammadirva/Downloads/Lite Postman Tauri" && npx tsc --noEmit && npx vite build`
Expected: clean pass, no errors or warnings.

- [ ] **Step 2: Manual smoke test**

Start the dev app (`npm run tauri dev` or equivalent) and walk through:

1. Click the sidebar "+" dropdown → confirm it shows "HTTP Request" / "gRPC Request" (not a single action anymore).
2. Create a gRPC Request → confirm it opens a new tab showing `GrpcPanel` (URL bar + Service/Message/Metadata/Settings tabs), not the HTTP `RequestPanel`.
3. In the Service tab, confirm both mock services (`helloworld.Greeter`, `chat.ChatService`) and all four methods are listed with correct method-type labels; select `SayHello`.
4. Confirm the Message tab now shows a single-JSON-object placeholder and the URL bar shows a `helloworld.Greeter.SayHello` badge.
5. Click Send → confirm the response area shows a `SENT` entry followed by a `RECEIVED` entry (~400ms later) with a JSON tree, and the Send button reads "Streaming…" while in flight.
6. Switch to `SayHelloStream` (server-stream) → Send → confirm 3 `RECEIVED` entries stream in with a short delay between each.
7. Switch to `SendMessages` (client-stream) → confirm the Message tab placeholder/hint switches to "JSON array" mode → edit the array to 2 items → Send → confirm 2 `SENT` entries appear in sequence, then 1 `RECEIVED` summary.
8. Switch to `Chat` (bidi) → Send → confirm alternating `SENT`/`RECEIVED` entries.
9. Add a metadata row in the Metadata tab → confirm the tab label updates to show the count, e.g. "Metadata (1)".
10. Toggle Settings between "Server reflection" and "Imported .proto" → confirm the explanatory text below changes.
11. Toggle the layout preference between "side" and "bottom" (existing Settings modal option) → confirm the gRPC panel/response-log pair resizes and re-splits exactly like the HTTP panel pair already does.
12. Open an existing HTTP request tab → confirm it still renders `RequestPanel`/`ResponsePanel` exactly as before, completely unaffected.
13. In Settings, click "Export Collection" after having at least one gRPC request in the tree → confirm the status message reports "N gRPC requests skipped — Postman does not support gRPC in collection exports" and the written file has no gRPC data in it.
14. Right-click a folder → confirm the context menu now shows "New HTTP Request" and "New gRPC Request" as separate options.

If all 14 checks pass, Phase 1 is ready for the user's review. Phase 2 (real `tonic`/`prost-reflect`/`protox` backend, `Channel<T>` streaming) gets its own plan after this one is reviewed and approved.
