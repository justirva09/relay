import { Workspace, TreeNode } from "../types";
import { renderMarkdown } from "./markdown";
import { escapeHtml } from "./highlight";

const METHOD_COLOR: Record<string, string> = {
  GET: "#34d399",
  POST: "#38bdf8",
  PUT: "#fbbf24",
  PATCH: "#a78bfa",
  DELETE: "#fb7185",
  HEAD: "#94a3b8",
  OPTIONS: "#94a3b8",
};

function kvTable(rows: { key: string; value: string; enabled: boolean }[], emptyLabel: string): string {
  const active = rows.filter((r) => r.enabled && r.key.trim());
  if (active.length === 0) return `<p class="empty">${emptyLabel}</p>`;
  const body = active
    .map((r) => `<tr><td class="key">${escapeHtml(r.key)}</td><td class="val">${escapeHtml(r.value)}</td></tr>`)
    .join("");
  return `<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${body}</tbody></table>`;
}

function navEntries(nodes: TreeNode[], depth: number): string {
  return nodes
    .map((n) => {
      if (n.kind === "folder") {
        return `<div class="nav-folder" style="padding-left:${depth * 14}px">${escapeHtml(n.name)}</div>${navEntries(n.children, depth + 1)}`;
      }
      const label = n.kind === "grpc" ? "gRPC" : n.request.method;
      const color = n.kind === "grpc" ? "#8da0f7" : METHOD_COLOR[n.request.method] || "#94a3b8";
      return `<a class="nav-item" href="#req-${n.id}" style="padding-left:${depth * 14 + 14}px"><span class="badge" style="color:${color}">${escapeHtml(label)}</span>${escapeHtml(n.name)}</a>`;
    })
    .join("");
}

function requestSections(nodes: TreeNode[]): string {
  return nodes
    .map((n) => {
      if (n.kind === "folder") return requestSections(n.children);
      if (n.kind === "grpc") {
        const req = n.request;
        return `
          <section class="request" id="req-${n.id}">
            <div class="request-head">
              <span class="badge" style="color:#8da0f7">gRPC</span>
              <h2>${escapeHtml(n.name)}</h2>
            </div>
            <p class="url">${escapeHtml(req.service)} / ${escapeHtml(req.method)} <span class="empty">(${escapeHtml(req.methodType)})</span></p>
            <p class="empty">No description provided.</p>
            <h3>Message</h3>
            <pre><code>${escapeHtml(req.messageJson)}</code></pre>
            <h3>Metadata</h3>
            ${kvTable(req.metadata, "No metadata.")}
          </section>`;
      }
      const req = n.request;
      const color = METHOD_COLOR[req.method] || "#94a3b8";
      return `
        <section class="request" id="req-${n.id}">
          <div class="request-head">
            <span class="badge" style="color:${color}">${escapeHtml(req.method)}</span>
            <h2>${escapeHtml(n.name)}</h2>
          </div>
          <p class="url">${escapeHtml(req.url)}</p>
          ${req.description ? `<div class="markdown-body">${renderMarkdown(req.description)}</div>` : `<p class="empty">No description provided.</p>`}
          <h3>Query Params</h3>
          ${kvTable(req.params, "No query params.")}
          ${req.pathParams.length > 0 ? `<h3>Path Variables</h3>${kvTable(req.pathParams, "None.")}` : ""}
          <h3>Headers</h3>
          ${kvTable(req.headers, "No headers set.")}
          ${
            req.bodyMode !== "none"
              ? `<h3>Body <span class="empty">(${escapeHtml(req.bodyMode)})</span></h3><pre><code>${escapeHtml(
                  req.bodyMode === "json" || req.bodyMode === "text" ? req.bodyText : JSON.stringify(req, null, 2)
                )}</code></pre>`
              : ""
          }
        </section>`;
    })
    .join("");
}

export function generateDocsHtml(workspace: Workspace): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(workspace.name || "API Documentation")}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f1117; color: #e4e6ec; }
  nav { width: 260px; flex-shrink: 0; height: 100vh; overflow-y: auto; border-right: 1px solid #222638; padding: 16px 0; position: sticky; top: 0; }
  nav h1 { font-size: 14px; padding: 0 16px 12px; margin: 0; }
  .nav-folder { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #5e6278; padding: 10px 16px 4px; }
  .nav-item { display: flex; align-items: center; gap: 8px; padding: 6px 16px; font-size: 13px; color: #8b8fa3; text-decoration: none; }
  .nav-item:hover { color: #e4e6ec; background: rgba(255,255,255,0.05); }
  main { flex: 1; min-width: 0; padding: 32px 48px; max-width: 760px; }
  .request { border-bottom: 1px solid #222638; padding-bottom: 28px; margin-bottom: 28px; }
  .request-head { display: flex; align-items: center; gap: 10px; }
  .request-head h2 { font-size: 18px; margin: 0; }
  .badge { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; border: 1px solid currentColor; border-radius: 4px; padding: 1px 6px; }
  .url { font-family: ui-monospace, monospace; font-size: 12.5px; color: #8b8fa3; margin: 6px 0 14px; word-break: break-all; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #5e6278; margin: 16px 0 6px; }
  .empty { font-size: 12.5px; color: #5e6278; font-style: italic; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { border: 1px solid #222638; padding: 5px 10px; text-align: left; }
  th { color: #8b8fa3; font-weight: 600; background: #161922; }
  td.key { font-family: ui-monospace, monospace; color: #c4b5fd; }
  td.val { font-family: ui-monospace, monospace; }
  pre { background: #12151e; border: 1px solid #2a2e42; border-radius: 6px; padding: 12px 14px; overflow-x: auto; font-size: 12.5px; }
  code { font-family: ui-monospace, monospace; }
  .markdown-body { font-size: 13.5px; line-height: 1.6; color: #e4e6ec; }
  .markdown-body p { margin: 0.5em 0; }
  .markdown-body code { background: #12151e; border: 1px solid #2a2e42; border-radius: 4px; padding: 0.1em 0.4em; font-size: 0.9em; }
  .markdown-body pre code { border: none; padding: 0; }
  .markdown-body a { color: #8da0f7; }
  footer { font-size: 11px; color: #3e4258; margin-top: 24px; }
</style>
</head>
<body>
<nav>
  <h1>${escapeHtml(workspace.name || "API Documentation")}</h1>
  ${navEntries(workspace.tree, 0)}
</nav>
<main>
  ${requestSections(workspace.tree)}
  <footer>Generated by Relay on ${escapeHtml(new Date().toLocaleString())}</footer>
</main>
</body>
</html>`;
}
