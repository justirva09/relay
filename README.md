# Relay

Postman-lite berbasis desktop (Tauri v2 + React + TypeScript + Rust).
Request HTTP-nya dijalankan **native lewat Rust (`reqwest`)**, bukan `fetch()` di browser —
jadi gak ada batasan CORS dan lebih ringan/cepat daripada webview biasa atau Electron.
Ada juga dukungan **gRPC** (native lewat `tonic`/`prost`), baik lewat server reflection maupun
`.proto` lokal (tanpa perlu server-nya expose reflection).

## Fitur yang sudah ada

### HTTP
- Sidebar collections: folder & request, nested, rename (double-click), delete, collapse
- Multi-tab request (buka beberapa request sekaligus, tab dengan indikator unsaved `●`)
- Params ⟷ URL auto-sync (ala Postman), auto-tambah row baru saat mulai ngetik
- Headers, Body (none/json/text), tombol **Prettify** buat body JSON
- Tab Headers bisa nampilin **auto-generated headers** (`User-Agent`, `Content-Type`, `Host`, `Content-Length`) yang bakal ke-attach otomatis kalau gak diisi manual — toggle show/hide, read-only
- Default `User-Agent: Relay/x.y.z` selalu dikirim (bisa di-override manual) — biar API yang nolak client tanpa User-Agent (contoh: GitHub REST API) tetep jalan out of the box
- Pre-request script & Tests (post-response script) dengan `pm` API mini:
  - `pm.environment.get/set/unset`, `pm.variables.get/set`
  - `pm.request.method/url/body`, `pm.request.headers.add/upsert/remove/get`
  - `pm.response.code/status/responseTime/json()/text()/headers.get()`
  - `pm.test(name, fn)`, `pm.expect(x).to.equal/include/be.above/below/a/ok`
- Environment/global variables (`{{var}}` di URL, header, body) — panel di bawah sidebar
- Response viewer: status, waktu, ukuran, body, headers, test results, console log

### gRPC
- Request gRPC (unary) lewat native Rust client (`tonic`), dua mode discovery service:
  - **Server reflection** — auto-detect service/method dari server yang lagi jalan (butuh reflection enabled di server)
  - **Imported .proto** — import folder root proto repo (scan rekursif, resolve import antar file persis kayak `protoc -I`), buat server yang reflection-nya dimatiin. Well-known types (`google/protobuf/*.proto`, `buf/validate/validate.proto`) sudah dibundle
  - Proto yang diimport jadi **shared library di level workspace** (import sekali, dipakai semua request gRPC), picker "active spec file" cuma nampilin file yang beneran declare `service {}` (bukan file message/entity)
- Tab **Service definition**: toggle reflection/imported, searchable dropdown milih active spec file (grouped by package)
- Response panel gRPC: toggle **Response** (status, durasi, size, tab Body/Metadata — mirip response HTTP) vs **Log** (timeline SENT/RECV)
- Tombol **Prettify** di message editor (JSON request body)

### Umum
- Body/response viewer (`CodeView`) pakai gutter nomor baris asli + garis vertikal + **collapsible fold** per object/array (bracket-matching, nomor baris gak berubah pas collapse — mirip VSCode)
- Toggle light/dark & Settings ada di kanan atas panel utama
- Semua collection, environment, & proto library disimpan otomatis ke disk (app data dir, `workspace.json`)

## Belum ada / rencana ke depan
- Streaming gRPC (server-stream/client-stream/bidi) — baru unary yang beneran jalan, sisanya masih mock
- Drag & drop reorder folder/request (sekarang hanya add/rename/delete)
- Auth tab (Bearer/Basic/OAuth) — sementara bisa manual lewat Headers atau pre-request script
- Import/export collection (Postman/OpenAPI)

## Menjalankan (development)

Prasyarat:
- Node.js 18+ dan npm
- Rust stable (`rustup`) — https://www.rust-lang.org/tools/install
- Tauri system dependencies sesuai OS: https://v2.tauri.app/start/prerequisites/
  (di Linux perlu `libwebkit2gtk-4.1-dev`, `libssl-dev`, `librsvg2-dev`, `build-essential`, dll — ada di link di atas)

```bash
npm install
npm run tauri dev
```

Ini akan buka window aplikasi desktop-nya langsung (hot-reload untuk frontend).

## Build production

```bash
npm run tauri build
```

Hasil installer/executable ada di `src-tauri/target/release/bundle/`.

Icon di `src-tauri/icons/` masih placeholder sederhana (PNG saja, belum ada `.icns`/`.ico`).
Untuk build production yang proper di semua OS, generate set icon lengkap dari 1 gambar sumber:

```bash
npm run tauri icon path/to/logo.png
```

## Release (macOS + Windows)

Ada GitHub Action manual (`.github/workflows/release.yml`) buat build & rilis:

1. Buka tab **Actions** di repo → workflow **Release** → **Run workflow**
2. Isi `version` (contoh `v0.1.0`)
3. Workflow build macOS (universal, Intel+Apple Silicon) & Windows, terus upload installer-nya ke **draft** GitHub Release — review dulu asset-nya sebelum di-publish manual

⚠️ Windows bundler (msi/nsis) butuh `.ico` — kalau icon masih placeholder PNG (lihat di atas), build Windows-nya bisa gagal. Generate icon lengkap dulu (`npm run tauri icon ...`) sebelum run release pertama kali.

## Struktur

```
src/                    # frontend React + TypeScript
  components/
    Sidebar.tsx, TabBar.tsx, KeyValueEditor.tsx, CodeEditor.tsx (editable), CodeView.tsx (read-only, gutter + fold)
    RequestPanel.tsx, ResponsePanel.tsx           # HTTP
    GrpcPanel.tsx, GrpcResponsePanel.tsx,
    GrpcServicePicker.tsx, GrpcResponseLog.tsx     # gRPC
    EnvironmentModal.tsx                          # env panel + theme/settings buttons (top-right main panel)
  lib/
    pm.ts                # pre/post-request script engine (pm API)
    tauri.ts             # invoke() wrappers ke Rust commands (HTTP + file/proto pickers)
    grpcClient.ts         # invoke() wrappers khusus gRPC commands
    useSendRequest.ts     # orkestrasi HTTP: pre-script -> native request -> test-script
    highlight.ts          # syntax highlight dipakai bareng CodeEditor & CodeView
  store.tsx             # context: workspace tree, tabs, proto library, persistence
  types.ts              # tipe data + tree helpers

src-tauri/               # backend Rust
  src/
    commands.rs          # command http_request (reqwest, async)
    grpc.rs              # gRPC: reflection client, local .proto parsing (protox), invoke_unary
    storage.rs           # load/save workspace.json, baca folder .proto rekursif
    wellknown/buf/validate/validate.proto   # bundled well-known type (protovalidate)
    main.rs
  tauri.conf.json
  capabilities/default.json
```
