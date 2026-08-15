# gRPC Support — Design Spec

Date: 2026-08-14
Status: Approved (design), pending implementation plan

## Context

Relay is a Tauri 2 desktop API client (React 18 + TypeScript, Rust backend) currently HTTP-only. This spec adds gRPC request support: server reflection, manual `.proto` import fallback, unary + all three streaming modes, metadata, and a new "Scripts"-style panel — while explicitly deferring Postman-compatible export for gRPC (Postman itself cannot export gRPC requests as of this writing — confirmed via postmanlabs/postman-app-support issues #11579 and #11252) and deferring "save gRPC example" (Postman has this; out of scope for v1).

## Goals

- Full scope: unary + streaming (server/client/bidi) + reflection + manual `.proto` import.
- New-request flow: dropdown on the sidebar "+" button — "HTTP Request" / "gRPC Request" — not a separate protocol-picker modal.
- Streaming responses render log-style (append-only, timestamped), for all streaming kinds — no chat-style interactive send.
- Client-streaming/bidi request messages are authored as a single JSON array up front; all messages send in sequence on "Send" with no further interaction once the call is running.
- `.proto` files imported manually are scoped per-collection (per top-level folder), not per-request — multiple gRPC requests in the same folder share one proto set.
- TLS is inferred from URL scheme (`grpcs://` = TLS, `grpc://`/bare = plaintext) — no separate toggle, no client-cert/mTLS support in v1.
- Postman export: gRPC requests are skipped with a visible warning (e.g. "2 gRPC requests skipped — Postman does not support gRPC in collection exports"). Relay's own native workspace format supports gRPC nodes natively (full round-trip within Relay).
- "Save gRPC example" — explicitly out of scope for v1.

## Phasing

**Phase 1 — UI/UX only, mocked data.** Build the full gRPC interaction surface (new node kind, sidebar dropdown, GrpcPanel, service/method picker, message editor, metadata editor, response log) against static/mock service+method lists and canned mock responses. No Rust backend changes. Purpose: let the user review and approve the actual interaction design before the more expensive backend work begins.

**Phase 2 — Real backend.** Only after Phase 1 UI is reviewed and approved. Wires `tonic` + `prost-reflect` + `protox` in Rust, real reflection queries, real dynamic protobuf encode/decode, real streaming over Tauri `Channel<T>`.

This spec covers both phases; the implementation plan (next step, via writing-plans) should sequence Phase 1 as its own reviewable milestone before Phase 2 starts.

## Non-goals (v1)

- Interactive mid-call message sending for client-streaming/bidi (messages are authored as an upfront JSON array instead).
- mTLS / client certificates.
- Saving gRPC request-response examples.
- Postman-compatible gRPC export (no such schema exists upstream).
- A generic third-party plugin system (discussed separately; not part of this feature).

## Architecture

### Dynamic protobuf (no compile-time codegen)

- **`prost-reflect`** for `DynamicMessage` construction/encoding/decoding and JSON↔protobuf conversion (serde-based), driven by descriptors obtained either from:
  - the server's reflection service (`grpc.reflection.v1alpha.ServerReflection`), or
  - a `FileDescriptorSet` compiled at import time from user-supplied `.proto` text.
- **`protox`** (pure-Rust `.proto` compiler) compiles imported `.proto` files to descriptors without requiring a system-installed `protoc` binary. This was the deciding factor over shelling out to `protoc`, which would require users to install a separate tool.
- **`tonic`** provides the HTTP/2 transport/channel and the reflection client.

### Streaming transport

- Tauri 2 **`Channel<T>`** (per-invocation, typed) rather than global event emit. Rationale: multiple gRPC tabs streaming concurrently must not cross-talk; a global `app_handle.emit` bus risks exactly that, while a `Channel` is scoped to the single `invoke` call that created it.
- Unary calls are modeled as a single-chunk stream for a uniform code path on both backend and frontend.

### Data model (`types.ts`)

```typescript
export type TreeNode = FolderNode | RequestNode | GrpcRequestNode;

export interface GrpcRequestNode {
  id: string;
  kind: "grpc";
  name: string;
  request: GrpcRequestData;
}

export type GrpcMethodType = "unary" | "server-stream" | "client-stream" | "bidi";

export interface GrpcRequestData {
  url: string;                    // e.g. "grpcs://api.example.com:443"
  service: string;                // fully-qualified service name, e.g. "pkg.UserService"
  method: string;                 // method name, e.g. "GetUser"
  methodType: GrpcMethodType;
  messageJson: string;            // single JSON object (unary/server-stream) or JSON array (client-stream/bidi)
  metadata: KVRow[];               // gRPC metadata, reuses existing KVRow shape/UI
  protoSource: "reflection" | "imported";
}

// FolderNode gains an optional shared proto set for imported-mode gRPC requests within it:
export interface FolderNode {
  id: string;
  kind: "folder";
  name: string;
  collapsed?: boolean;
  children: TreeNode[];
  protoFiles?: { name: string; content: string }[]; // only meaningful when descendant grpc requests use protoSource: "imported"
}
```

Rationale for a new `kind: "grpc"` node (over a `protocol` discriminant inside the existing `RequestNode`): all HTTP-specific code (`postman.ts`, `useSendRequest.ts`, `pm.ts`) already narrows on `kind === "request"` and needs zero changes. gRPC logic lives in its own files/types with no risk of accidentally widening HTTP-only assumptions.

Tree-generic operations (rename, delete, move/drag-drop, collapse) are kind-agnostic today (they pattern-match on `n.kind === "folder"` and otherwise no-op or apply generically) and continue to work unmodified for the new `"grpc"` kind — this was verified against `store.tsx`'s `mapTree`, `findNode`, `moveNode` helpers, which only special-case `"folder"`.

### New components

- **`GrpcPanel.tsx`** — mounted instead of `RequestPanel` when the active tab's node `kind === "grpc"`. Layout:
  - URL bar (reuses the `UrlInput` pattern from `RequestPanel`) + Connect action.
  - Tab row: **Service** (browse/search reflected or imported services+methods), **Message** (JSON body, reuses `CodeEditor`), **Metadata** (reuses `KeyValueEditor`), **Settings** (reflection vs. imported-proto toggle, shows the folder's shared proto set when in imported mode).
- **`GrpcResponseLog.tsx`** — log-style append-only viewer. Each received message is a timestamped entry; unary shows exactly one. Reuses the JSON tree renderer/syntax tokens (`text-th-syn-*`) already built for `ResponsePanel`.
- **Sidebar "+" dropdown** — the existing single-action "+" button in `Sidebar.tsx` becomes a small dropdown with "HTTP Request" / "gRPC Request", following the same pattern as `MethodDropdown`/`EnvDropdown` (button + absolute positioned list, click-outside-to-close).

### Data flow (Phase 2)

1. User picks reflection or imports `.proto` (Settings tab) → backend returns a service/method tree.
2. User selects a method → panel shows the right message editor shape (object for unary/server-stream, array for client-stream/bidi) and locks `methodType` accordingly.
3. Send → backend opens a `tonic` channel, builds `DynamicMessage`(s) from `messageJson` via `prost-reflect`, invokes the call, streams response chunks back over the `Channel<T>`.
4. Frontend appends each chunk to `GrpcResponseLog` as it arrives; connection close ends the log.

### Error handling

- Reflection unavailable (call fails/unimplemented) → Settings tab surfaces a clear prompt to import `.proto` files instead, mirroring the existing pre-request script error UX (a dedicated error slot, not a silent failure).
- `.proto` parse/compile errors (from `protox`) → surfaced in the same slot with the compiler's message.
- Connection/transport errors → same visual pattern as the existing HTTP `response.error` state in `ResponsePanel`.
- Mid-stream errors → appended to the log as a distinct error-styled entry (reusing the existing rose/error token), stream then closes.

### Export/import behavior

- Relay-native workspace export/import: `"grpc"` nodes round-trip fully (already representable — native format is just the `TreeNode` union serialized as-is).
- Postman v2.1 export (`treeToPostman`): `"grpc"` nodes are filtered out; the export flow surfaces a count of skipped items and the reason ("Postman does not support gRPC in collection exports").
- Postman import (`postmanToTree`): no gRPC data can appear in a genuine Postman export (matches the above), so no gRPC-specific import handling is needed — unaffected.

### Testing

- **Phase 1**: no new test framework introduced (none exists today — no jest/vitest, no Rust `#[test]` modules). Verification is `tsc --noEmit` + `vite build` after each change, plus manual interaction review by the user (the explicit point of doing Phase 1 first).
- **Phase 2**: `cargo test` covering the `prost-reflect` JSON↔`DynamicMessage` round-trip (the highest-risk correctness surface — a wrong conversion silently corrupts every request/response), plus manual verification against at least one real gRPC server with reflection enabled and one `.proto`-imported server without it.

## Open items deferred to the implementation plan

- Exact Rust command signatures (`invoke_handler` entries) for reflect/connect/send/stream.
- Exact shape of the mock data used in Phase 1 (should resemble a realistic service, e.g. modeled loosely on a small public gRPC service, to make Phase 2 wiring a near-drop-in replacement).
- Where the "N gRPC requests skipped" export notice surfaces in the UI (toast vs. inline in the Settings export flow).
