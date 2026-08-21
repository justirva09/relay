# Contributing to Relay

## Setup

Prerequisites:
- Node.js 18+ and npm
- Rust stable (via [rustup](https://www.rust-lang.org/tools/install))
- Tauri system dependencies for your OS: see [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run tauri dev
```

This opens the desktop app with hot-reload for the frontend. Rust changes require a restart.

## Before opening a PR

```bash
npx tsc --noEmit      # frontend type-check
cd src-tauri && cargo check   # backend type-check
```

Both must pass clean. There's no automated test suite yet — manually exercise the feature you touched in the running app.

## Project structure

See the "Project structure" section in [README.md](README.md) for a map of `src/` and `src-tauri/src/`.

## PR guidelines

- Keep PRs focused — one feature/fix per PR
- Match existing code style (no linter enforced yet, follow surrounding code)
- Describe *why*, not just *what*, in the PR description
- Screenshots/GIFs for UI changes are appreciated

## Reporting bugs / requesting features

Open a GitHub issue. Include repro steps, OS, and Relay version for bugs.

For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead — don't open a public issue.
