import { Workspace, TreeNode } from "../types";
import { renderMarkdown } from "./markdown";
import { escapeHtml, highlightJSON, isJsonLike } from "./highlight";

const METHOD_COLOR: Record<string, string> = {
  GET: "#34d399",
  POST: "#38bdf8",
  PUT: "#fbbf24",
  PATCH: "#a78bfa",
  DELETE: "#fb7185",
  HEAD: "#94a3b8",
  OPTIONS: "#94a3b8",
  GRPC: "#8da0f7",
};

function countEndpoints(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => {
    if (n.kind === "folder") return sum + countEndpoints(n.children);
    return sum + 1;
  }, 0);
}

function kvTable(rows: { key: string; value: string; enabled: boolean }[], emptyLabel: string): string {
  const active = rows.filter((r) => r.enabled && r.key.trim());
  if (active.length === 0) return `<p class="empty">${emptyLabel}</p>`;
  const body = active
    .map((r) => `<tr><td class="key">${escapeHtml(r.key)}</td><td class="val">${escapeHtml(r.value)}</td></tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function codeBlock(code: string): string {
  const highlighted = isJsonLike(code) ? highlightJSON(code) : escapeHtml(code);
  return `<div class="code-block"><button class="copy-btn" type="button" data-copy>Copy</button><pre><code>${highlighted}</code></pre></div>`;
}

function methodChip(label: string, color: string): string {
  return `<span class="badge" style="color:${color};background:color-mix(in srgb, ${color} 18%, transparent);border-color:color-mix(in srgb, ${color} 45%, transparent)">${escapeHtml(label)}</span>`;
}

function navEntries(nodes: TreeNode[], depth: number): string {
  return nodes
    .map((n) => {
      if (n.kind === "folder") {
        return `<div class="nav-folder" style="padding-left:${depth * 14 + 16}px">${escapeHtml(n.name)}</div>${navEntries(n.children, depth + 1)}`;
      }
      const label = n.kind === "grpc" ? "gRPC" : n.request.method;
      const color = n.kind === "grpc" ? METHOD_COLOR.GRPC : METHOD_COLOR[n.request.method] || "#94a3b8";
      return `<a class="nav-item" data-nav="req-${n.id}" href="#req-${n.id}" style="padding-left:${depth * 14 + 16}px">${methodChip(label, color)}<span class="nav-item-label">${escapeHtml(n.name)}</span></a>`;
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
              ${methodChip("gRPC", METHOD_COLOR.GRPC)}
              <h2>${escapeHtml(n.name)}</h2>
            </div>
            <p class="url">${escapeHtml(req.service)} / ${escapeHtml(req.method)} <span class="empty">(${escapeHtml(req.methodType)})</span></p>
            <p class="empty">No description provided.</p>
            <h3>Message</h3>
            ${codeBlock(req.messageJson)}
            <h3>Metadata</h3>
            ${kvTable(req.metadata, "No metadata.")}
          </section>`;
      }
      const req = n.request;
      const color = METHOD_COLOR[req.method] || "#94a3b8";
      return `
        <section class="request" id="req-${n.id}">
          <div class="request-head">
            ${methodChip(req.method, color)}
            <h2>${escapeHtml(n.name)}</h2>
          </div>
          <p class="url">${escapeHtml(req.url)}</p>
          ${req.description ? `<div class="markdown-body">${renderMarkdown(req.description)}</div>` : `<p class="empty">No description provided.</p>`}
          <h3>Query Params</h3>
          ${kvTable(req.params, "No query params.")}
          ${req.pathParams.length > 0 ? `<h3>Path Variables</h3>${kvTable(req.pathParams, "None.")}` : ""}
          ${
            req.auth.type === "bearer"
              ? `<h3>Auth</h3><p class="url">Bearer Token: ${escapeHtml(req.auth.bearer?.token || "")}</p>`
              : req.auth.type === "basic"
              ? `<h3>Auth</h3><p class="url">Basic Auth: ${escapeHtml(req.auth.basic?.username || "")} / ${escapeHtml(req.auth.basic?.password || "")}</p>`
              : ""
          }
          <h3>Headers</h3>
          ${kvTable(req.headers, "No headers set.")}
          ${
            req.bodyMode !== "none"
              ? `<h3>Body <span class="empty">(${escapeHtml(req.bodyMode)})</span></h3>${codeBlock(
                  req.bodyMode === "json" || req.bodyMode === "text" ? req.bodyText : JSON.stringify(req, null, 2)
                )}`
              : ""
          }
        </section>`;
    })
    .join("");
}

export function generateDocsHtml(workspace: Workspace): string {
  const endpointCount = countEndpoints(workspace.tree);
  const generatedAt = new Date().toLocaleString();
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(workspace.name || "API Documentation")}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f1117; color: #e4e6ec; }
  nav { width: 268px; flex-shrink: 0; height: 100vh; overflow-y: auto; border-right: 1px solid #222638; padding: 20px 0 24px; position: sticky; top: 0; }
  nav h1 { font-size: 14px; font-weight: 600; padding: 0 16px 4px; margin: 0; }
  nav .nav-meta { font-size: 11.5px; color: #5e6278; padding: 0 16px 16px; border-bottom: 1px solid #1b1e2b; margin-bottom: 8px; }
  .nav-folder { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #5e6278; font-weight: 600; padding: 16px 16px 6px; }
  .nav-item { display: flex; align-items: center; gap: 8px; padding: 6px 16px; font-size: 13px; color: #8b8fa3; text-decoration: none; border-radius: 6px; margin: 0 8px; width: calc(100% - 16px); }
  .nav-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-item:hover { color: #e4e6ec; background: rgba(255,255,255,0.05); }
  .nav-item.active { color: #e4e6ec; background: rgba(141,160,247,0.14); }
  main { flex: 1; min-width: 0; padding: 40px 56px 80px; max-width: 820px; }
  .doc-header { margin-bottom: 36px; padding-bottom: 24px; border-bottom: 1px solid #222638; }
  .doc-header h1 { font-size: 24px; margin: 0 0 6px; }
  .doc-header .meta { font-size: 12.5px; color: #5e6278; }
  .request { border-bottom: 1px solid #222638; padding-bottom: 32px; margin-bottom: 32px; scroll-margin-top: 24px; }
  .request:last-child { border-bottom: none; }
  .request-head { display: flex; align-items: center; gap: 10px; }
  .request-head h2 { font-size: 19px; margin: 0; font-weight: 600; }
  .badge { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; border: 1px solid currentColor; border-radius: 5px; padding: 2px 7px; white-space: nowrap; }
  .url { font-family: ui-monospace, monospace; font-size: 12.5px; color: #8b8fa3; margin: 8px 0 16px; word-break: break-all; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #5e6278; font-weight: 600; margin: 20px 0 8px; }
  .empty { font-size: 12.5px; color: #5e6278; font-style: italic; margin: 0; }
  .table-wrap { border: 1px solid #222638; border-radius: 8px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { padding: 7px 12px; text-align: left; border-bottom: 1px solid #1b1e2b; }
  tr:last-child td { border-bottom: none; }
  th { color: #8b8fa3; font-weight: 600; background: #161922; }
  tbody tr:nth-child(even) { background: rgba(255,255,255,0.015); }
  td.key { font-family: ui-monospace, monospace; color: #c4b5fd; }
  td.val { font-family: ui-monospace, monospace; }
  .code-block { position: relative; }
  .code-block pre { background: #12151e; border: 1px solid #2a2e42; border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-size: 12.5px; margin: 0; }
  .code-block code { font-family: ui-monospace, monospace; line-height: 1.6; }
  .copy-btn { position: absolute; top: 8px; right: 8px; font-size: 11px; color: #8b8fa3; background: #1b1e2b; border: 1px solid #2a2e42; border-radius: 5px; padding: 3px 8px; cursor: pointer; opacity: 0; transition: opacity 0.12s; }
  .code-block:hover .copy-btn { opacity: 1; }
  .copy-btn:hover { color: #e4e6ec; border-color: #3e4258; }
  .copy-btn.copied { color: #34d399; opacity: 1; }
  .text-th-syn-key { color: #c4b5fd; }
  .text-th-syn-string { color: #86efac; }
  .text-th-syn-bool { color: #fbbf24; }
  .text-th-syn-number { color: #7dd3fc; }
  .markdown-body { font-size: 13.5px; line-height: 1.65; color: #e4e6ec; }
  .markdown-body p { margin: 0.5em 0; }
  .markdown-body code { background: #12151e; border: 1px solid #2a2e42; border-radius: 4px; padding: 0.1em 0.4em; font-size: 0.9em; }
  .markdown-body pre code { border: none; padding: 0; }
  .markdown-body a { color: #8da0f7; }
  footer { font-size: 11px; color: #3e4258; margin-top: 8px; }
</style>
</head>
<body>
<nav>
  <h1>${escapeHtml(workspace.name || "API Documentation")}</h1>
  <div class="nav-meta">${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}</div>
  ${navEntries(workspace.tree, 0)}
</nav>
<main>
  <div class="doc-header">
    <h1>${escapeHtml(workspace.name || "API Documentation")}</h1>
    <div class="meta">${endpointCount} endpoint${endpointCount === 1 ? "" : "s"} &middot; generated ${escapeHtml(generatedAt)}</div>
  </div>
  ${requestSections(workspace.tree)}
  <footer>Generated by Relay</footer>
</main>
<script>
(function () {
  var navItems = Array.prototype.slice.call(document.querySelectorAll(".nav-item"));
  var sections = navItems
    .map(function (a) { return document.getElementById(a.getAttribute("data-nav")); })
    .filter(Boolean);
  if (sections.length && "IntersectionObserver" in window) {
    var byId = {};
    navItems.forEach(function (a) { byId[a.getAttribute("data-nav")] = a; });
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var link = byId[entry.target.id];
          if (!link) return;
          if (entry.isIntersecting) {
            navItems.forEach(function (a) { a.classList.remove("active"); });
            link.classList.add("active");
          }
        });
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    sections.forEach(function (s) { observer.observe(s); });
  }

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var code = btn.parentElement.querySelector("code");
      if (!code || !navigator.clipboard) return;
      navigator.clipboard.writeText(code.textContent || "").then(function () {
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1200);
      });
    });
  });
})();
</script>
</body>
</html>`;
}
