# Lite Postman (Tauri)

Postman-lite berbasis desktop (Tauri v2 + React + TypeScript + Rust).
Request HTTP-nya dijalankan **native lewat Rust (`reqwest`)**, bukan `fetch()` di browser —
jadi gak ada batasan CORS dan lebih ringan/cepat daripada webview biasa atau Electron.

## Fitur yang sudah ada
- Sidebar collections: folder & request, nested, rename (double-click), delete, collapse
- Multi-tab request (buka beberapa request sekaligus, tab dengan indikator unsaved `●`)
- Params ⟷ URL auto-sync (ala Postman), auto-tambah row baru saat mulai ngetik
- Headers, Body (none/json/text)
- Pre-request script & Tests (post-response script) dengan `pm` API mini:
  - `pm.environment.get/set/unset`, `pm.variables.get/set`
  - `pm.request.method/url/body`, `pm.request.headers.add/upsert/remove/get`
  - `pm.response.code/status/responseTime/json()/text()/headers.get()`
  - `pm.test(name, fn)`, `pm.expect(x).to.equal/include/be.above/below/a/ok`
- Environment/global variables (`{{var}}` di URL, header, body) — panel di bawah sidebar
- Response viewer: status, waktu, ukuran, body (auto pretty JSON), headers, test results, console log
- Semua collection & environment disimpan otomatis ke disk (app data dir, `workspace.json`)

## Belum ada / rencana ke depan
- gRPC request (arsitektur sudah disiapkan supaya bisa ditambah sebagai command Rust baru + tab jenis request baru, tinggal tambah `.proto` parsing pakai crate `tonic`/`prost` dan reflection)
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

## Struktur

```
src/                    # frontend React + TypeScript
  components/           # Sidebar, TabBar, RequestPanel, ResponsePanel, KeyValueEditor
  lib/
    pm.ts               # pre/post-request script engine (pm API)
    tauri.ts            # invoke() wrappers ke Rust commands
    useSendRequest.ts    # orkestrasi: pre-script -> native request -> test-script
  store.tsx             # context: workspace tree, tabs, persistence
  types.ts              # tipe data + tree helpers

src-tauri/               # backend Rust
  src/
    commands.rs          # command http_request (reqwest, async)
    storage.rs            # load/save workspace.json ke app data dir
    main.rs
  tauri.conf.json
  capabilities/default.json
```
