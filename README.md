# Relay

A lightweight, Postman-style desktop client built with **Tauri v2 + React + TypeScript + Rust**.

Requests run **natively through Rust** (`reqwest` for HTTP, `tonic`/`prost` for gRPC) instead of the browser's `fetch()` — no CORS restrictions, and lighter/faster than a webview-based or Electron app.

Collections are stored as **plain-text `.relay` files** (one file per request/folder/environment), so diffs stay small and workspaces can be versioned and shared with git like regular source code.

## Features

### HTTP
- Sidebar collections: folders & requests, nested, rename (double-click), delete, collapse
- Multi-tab requests with unsaved-change indicator (`●`)
- Params ⟷ URL two-way sync (Postman-style), auto-adds a new row as you type
- **Path variables**: `:id`-style segments in the URL are auto-detected, highlighted, and get their own tab to fill in values
- Headers, Body (none/json/text), **Prettify** button for JSON bodies
- Auto-generated headers (`User-Agent`, `Content-Type`, `Host`, `Content-Length`) shown read-only when not set manually; toggleable
- Default `User-Agent: Relay/x.y.z` sent unless overridden — keeps APIs that reject clientless requests (e.g. GitHub REST API) working out of the box
- Pre-request & test scripts with a mini `pm` API, including autocomplete:
  - `pm.environment.get/set/unset`, `pm.variables.get/set`
  - `pm.request.method/url/body`, `pm.request.headers.add/upsert/remove/get`
  - `pm.response.code/status/responseTime/json()/text()/headers.get()`
  - `pm.test(name, fn)`, `pm.expect(x).to.equal/include/be.above/below/a/ok`
- `{{variable}}` autocomplete & syntax highlighting in URL, headers, and params
- Environment & global variables panel
- Response viewer: status, time, size, body, headers, test results, console log
- Optional local response caching (toggle in Settings) — responses persist across restarts, never committed to git

### gRPC
- Unary requests through a native Rust client (`tonic`), two service-discovery modes:
  - **Server reflection** — auto-detects services/methods from a running server
  - **Imported `.proto`** — recursively scans and resolves imports like `protoc -I`, for servers with reflection disabled. Well-known types (`google/protobuf/*.proto`, `buf/validate/validate.proto`) are bundled
  - Imported protos are a shared library at the workspace level (import once, reuse across requests)
- **Service definition** tab: toggle reflection/imported, searchable method picker grouped by package
- Response panel: **Response** (status/duration/size, Body/Metadata tabs) vs **Log** (SENT/RECV timeline)
- **Prettify** button for the message editor

### Git-native storage
- Workspaces save as individual `.relay` files instead of one JSON blob — clean, reviewable git diffs
- **Flat** (files directly in the project folder) or **Hidden** (`.relay/` subfolder) layout, chosen when creating a workspace; existing folders with other content default to hidden so nothing gets overwritten
- Secret-marked variables are split into a gitignored `*.secret.relay` file, never committed
- Built-in **Source Control** panel: current branch, changed-file count, commit from the sidebar

### General
- Read-only body/response viewer (`CodeView`) with line-number gutter and collapsible object/array folds (VSCode-style)
- Light/dark theme toggle & Settings
- Everything autosaves to disk

## Roadmap
- Streaming gRPC (server-stream/client-stream/bidi) — only unary is implemented so far
- Drag & drop reorder for folders/requests
- Auth tab (Bearer/Basic/OAuth) — for now, use Headers or a pre-request script
- Import/export collections (Postman/OpenAPI)

## Development

Prerequisites:
- Node.js 18+ and npm
- Rust stable (via [rustup](https://www.rust-lang.org/tools/install))
- Tauri system dependencies for your OS: see [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)
  (Linux needs `libwebkit2gtk-4.1-dev`, `libssl-dev`, `librsvg2-dev`, `build-essential`, etc.)

```bash
npm install
npm run tauri dev
```

This opens the desktop app window directly, with hot-reload for the frontend.

## Production build

```bash
npm run tauri build
```

Installers/executables land in `src-tauri/target/release/bundle/`.

## Releases

Two GitHub Actions workflows handle builds:

- **`experimental-release.yml`** — runs automatically on every push to `main`. Builds macOS (universal) + Windows + Linux, auto-bumps an experimental version tag (`v0.2.0-N`), and uploads to a **draft** GitHub Release for manual review before publishing.
- **`release.yml`** — manual, versioned release. Run from the **Actions** tab, provide a version (e.g. `v0.2.0`), builds the same three platforms and uploads to a draft release.

## Project structure

```
src/                      # frontend — React + TypeScript
  components/
    Sidebar.tsx, TabBar.tsx, KeyValueEditor.tsx, CodeEditor.tsx (editable), CodeView.tsx (read-only)
    RequestPanel.tsx, ResponsePanel.tsx             # HTTP
    GrpcPanel.tsx, GrpcResponsePanel.tsx,
    GrpcServicePicker.tsx, GrpcResponseLog.tsx       # gRPC
    EnvironmentModal.tsx, SettingsModal.tsx, GitPanel.tsx
  lib/
    pm.ts                 # pre/post-request script engine
    pmCompletions.ts       # pm API autocomplete tree
    useVariableMenu.ts, urlHighlight.tsx  # {{variable}} autocomplete & highlighting
    tauri.ts, grpcClient.ts # invoke() wrappers to Rust commands
    useSendRequest.ts      # HTTP orchestration: pre-script -> native request -> test-script
    highlight.ts           # syntax highlight shared by CodeEditor & CodeView
  store.tsx               # workspace tree, tabs, proto library, persistence
  types.ts                # data types + tree helpers

src-tauri/                # backend — Rust
  src/
    commands.rs           # http_request command (reqwest, async)
    grpc.rs                # gRPC reflection client, local .proto parsing (protox), invoke_unary
    storage.rs             # .relay folder read/write, layout detection, git-ignore setup
    git.rs                 # in-app git status/commit via the `git` CLI
    response_cache.rs      # local-only response cache (app data dir)
    main.rs
  tauri.conf.json
  capabilities/default.json
```
