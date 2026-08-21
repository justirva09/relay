# Relay

A lightweight, Postman-style desktop API client — built with **Tauri v2 + React + TypeScript + Rust**.

Requests run **natively through Rust** (`reqwest` for HTTP, `tonic`/`prost` for gRPC) instead of a browser's `fetch()` — no CORS restrictions, and lighter/faster than a webview-based or Electron app. Collections are stored as **plain-text `.relay` files**, so diffs stay small and workspaces version cleanly with git.

<!-- TODO(image): banner/hero screenshot of the app here -->

## Why Relay

- **Git-native by design** — one file per request/folder/environment, not a single JSON blob. Reviewable diffs, no merge-conflict nightmares.
- **Native networking** — real Rust HTTP/gRPC clients, not a sandboxed webview fetch.
- **No account required to use it** — core HTTP/gRPC client is fully local and free.

<!-- TODO(image): screenshot of a request + response side by side -->

## Features

**HTTP**
- Collections sidebar (folders, requests, drag-and-drop reorder/move, multi-select)
- Params ⟷ URL two-way sync, path variables (`:id`), bulk edit mode
- Body: JSON, raw, form-urlencoded, multipart (real file uploads)
- **Auth tab**: Bearer, Basic, AWS SigV4, OAuth2 (Authorization Code + PKCE)
- Pre-request & test scripts (`pm` API, Postman-compatible subset) with autocomplete
- `{{variable}}` autocomplete/highlighting, environment & global variables
- Import Postman collections (v2.1) and OpenAPI 3.x specs; export back out

<!-- TODO(image): Auth tab screenshot -->

**gRPC**
- Unary requests via native Rust client (`tonic`)
- Server reflection or imported `.proto` (recursive import resolution, well-known types bundled)
- Response panel with Body/Metadata tabs and a SENT/RECV timeline log

<!-- TODO(image): gRPC service picker + response screenshot -->

**Runner & CI**
- **Runner**: run a folder/collection end-to-end with pass/fail summary
- **Relay CLI** (`relay-cli`): headless collection runs for CI/CD pipelines
- **Contract Check**: diff a live response against an OpenAPI spec

**Mock Server**
- Serve mock responses locally from a collection, no external server needed

**Git-native storage**
- `.relay` files, flat or hidden (`.relay/`) layout
- Secret-marked variables split into a gitignored `*.secret.relay` file
- Built-in Source Control panel (branch, changed files, commit)

<!-- TODO(image): mock server / runner screenshot -->

## Installation

Download the latest build from [Releases](../../releases) (macOS/Windows/Linux), or build from source below.

## Development

```bash
npm install
npm run tauri dev
```

Prerequisites and full contributor workflow: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Production build

```bash
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/`.

## Roadmap

- Streaming gRPC (server-stream/client-stream/bidi) — only unary is implemented so far

## Project structure

```
src/                      # frontend — React + TypeScript
  components/             # RequestPanel, GrpcPanel, RunnerPanel, EnvironmentModal, etc.
  lib/                     # pm.ts (script engine), useSendRequest.ts, tauri.ts (invoke wrappers)
  store.tsx                # workspace tree, tabs, persistence
  types.ts                 # data types + tree helpers

src-tauri/                # backend — Rust
  src/
    commands.rs            # http_request command (reqwest)
    grpc.rs                 # gRPC reflection + local .proto parsing
    storage.rs              # .relay folder read/write, git-ignore setup
    git.rs                  # in-app git status/commit
    mock_server.rs          # local mock server
  relay-cli/                # headless CLI, reuses the same Rust core
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Found a security issue? See [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[MIT](LICENSE)
