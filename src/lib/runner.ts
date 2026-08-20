import { KVRow, RequestData, ResponseState, StoredCookie, TreeNode, normalizeRequestData } from "../types";
import { runRequest } from "./useSendRequest";
import { APP_ICON_DATA_URI } from "../assets/appIconDataUri";
import { escapeHtml } from "./highlight";

export interface RunnerRequestRef {
  id: string;
  name: string;
  method: string;
  // Breadcrumb of enclosing folder names, e.g. ["Auth", "Login"] — shown in
  // the picker so two same-named requests in different folders aren't
  // ambiguous.
  path: string[];
  request: RequestData;
  tags: string[];
}

// Flattens the workspace tree into just its HTTP requests (gRPC isn't part
// of the Runner — pm-style test scripts/response assertions are an HTTP
// concept here) in the same order they appear in the sidebar.
export function flattenRequests(tree: TreeNode[], parentPath: string[] = []): RunnerRequestRef[] {
  const out: RunnerRequestRef[] = [];
  for (const node of tree) {
    if (node.kind === "folder") {
      out.push(...flattenRequests(node.children, [...parentPath, node.name]));
    } else if (node.kind === "request") {
      // The tab-open flow always normalizes a request before it's usable
      // (backfills pathParams/tags/settings/etc for older or imported files
      // saved before those fields existed) — the Runner reads straight from
      // the tree, so it needs the same normalization or a request missing a
      // newer field crashes runRequest instead of just running with defaults.
      const request = normalizeRequestData(node.request);
      out.push({ id: node.id, name: node.name, method: request.method, path: parentPath, request, tags: request.tags });
    }
  }
  return out;
}

export function filterByTags(items: RunnerRequestRef[], include: string[], exclude: string[]): RunnerRequestRef[] {
  return items.filter((item) => {
    if (include.length > 0 && !include.some((t) => item.tags.includes(t))) return false;
    if (exclude.length > 0 && exclude.some((t) => item.tags.includes(t))) return false;
    return true;
  });
}

// Minimal CSV parser — handles quoted fields (so a value can contain a
// comma) but not multi-line quoted cells, which is plenty for the small,
// flat key/value data sets a Runner data file realistically holds.
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells;
  };

  const header = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row: Record<string, string> = {};
    header.forEach((key, i) => (row[key] = cells[i] ?? ""));
    return row;
  });
}

export function parseDataFile(text: string, isJson: boolean): Record<string, string>[] {
  if (!isJson) return parseCsv(text);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Data file must be a JSON array of objects");
  return parsed.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) out[k] = v === null || v === undefined ? "" : String(v);
    return out;
  });
}

export interface RunnerResult {
  key: string;
  requestId: string;
  name: string;
  method: string;
  iteration: number;
  status: "passed" | "failed";
  response: ResponseState;
}

export interface RunnerOptions {
  delayMs: number;
  iterations: number;
  parallel: boolean;
  // Premium (Run with Parameters) — one iteration per row, overriding
  // `iterations` when present.
  dataRows?: Record<string, string>[];
}

function resultStatus(response: ResponseState): "passed" | "failed" {
  if (response.error) return "failed";
  if (response.testResults.length > 0) return response.testResults.every((t) => t.passed) ? "passed" : "failed";
  return response.ok ? "passed" : "failed";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs every selected request, `options.iterations` times (or once per
// `dataRows` row when set), reusing the exact same send pipeline as the
// request editor's own Send button — auth, scripts, cookies, everything
// behaves identically to sending it by hand.
export async function runCollection(
  items: RunnerRequestRef[],
  variables: KVRow[],
  onVariablesChange: (changed: Record<string, string>) => void,
  cookies: StoredCookie[],
  onCookiesChange: (updated: StoredCookie[]) => void,
  safeMode: boolean,
  options: RunnerOptions,
  onResult: (result: RunnerResult) => void,
  isCancelled: () => boolean
): Promise<void> {
  const totalIterations = options.dataRows?.length ?? options.iterations;

  for (let iteration = 0; iteration < totalIterations; iteration++) {
    if (isCancelled()) return;

    const dataRow = options.dataRows?.[iteration];
    // A data row's columns act as extra/overriding variables for just this
    // iteration's requests — never persisted back to the environment.
    const iterationVars = dataRow ? [...variables, ...Object.entries(dataRow).map(([key, value]) => ({ id: `runner-data-${key}`, key, value, enabled: true }))] : variables;

    const runOne = async (item: RunnerRequestRef) => {
      // A single request throwing (e.g. a malformed saved request, an
      // unexpected script error) must not take down the whole run — record
      // it as a failure and keep going, same as a request that comes back
      // with an HTTP error already does.
      let response: ResponseState;
      try {
        response = await runRequest(item.request, iterationVars, onVariablesChange, { safeMode, cookies, onCookiesChange });
      } catch (e: any) {
        response = {
          status: null,
          statusText: "",
          ok: false,
          time: 0,
          size: 0,
          headers: [],
          body: "",
          error: e?.message ?? String(e),
          testResults: [],
          logs: [],
          preError: null,
          request: { method: item.method, url: item.request.url, headers: [] },
        };
      }
      onResult({
        key: `${item.id}-${iteration}`,
        requestId: item.id,
        name: item.name,
        method: item.method,
        iteration,
        status: resultStatus(response),
        response,
      });
    };

    if (options.parallel) {
      await Promise.all(items.map(runOne));
    } else {
      for (const item of items) {
        if (isCancelled()) return;
        await runOne(item);
        if (options.delayMs > 0) await sleep(options.delayMs);
      }
    }
  }
}

export interface ReportRow {
  name: string;
  method: string;
  iteration: number;
  status: "passed" | "failed";
  statusCode: number | null;
  timeMs: number;
  error: string | null;
  assertions: { name: string; passed: boolean; error?: string }[];
  responseBody: string | null;
  requestBody: string | null;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

// Shared by both the JSON and HTML report paths so an assertion/body field
// added here shows up in both, not just whichever export happened to be
// touched last.
export function buildReportData(results: RunnerResult[]): ReportRow[] {
  return results.map((r) => {
    const failed = r.status === "failed";
    return {
      name: r.name,
      method: r.method,
      iteration: r.iteration,
      status: r.status,
      statusCode: r.response.status,
      timeMs: r.response.time,
      error: r.response.error,
      assertions: r.response.testResults,
      responseBody: failed ? r.response.body || null : null,
      requestBody: failed && BODY_METHODS.has(r.method.toUpperCase()) ? r.response.request.body ?? null : null,
    };
  });
}

export interface ReportMeta {
  environment?: string | null;
  runStartedAt?: string | null;
  tagFilter?: { include: string[]; exclude: string[] };
}

export function generateHtmlReport(results: RunnerResult[], meta?: ReportMeta): string {
  const data = buildReportData(results);
  const embeddedData = JSON.stringify(data).replace(/</g, "\\u003c");

  const include = meta?.tagFilter?.include ?? [];
  const exclude = meta?.tagFilter?.exclude ?? [];
  const subtitle =
    include.length > 0
      ? `Tagged "${escapeHtml(include.join(", "))}" run — grouped by request`
      : exclude.length > 0
      ? `Excluding "${escapeHtml(exclude.join(", "))}" — grouped by request`
      : "Full collection run — grouped by request";
  const environmentLabel = meta?.environment ? escapeHtml(meta.environment) : null;
  const runStartedAtLabel = meta?.runStartedAt ? escapeHtml(new Date(meta.runStartedAt).toLocaleString()) : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relay Runner Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:        #0a0a10;
    --bg-grid:   #0d0d14;
    --panel:     #131319;
    --panel-2:   #17171f;
    --raised:    #1b1b24;
    --border:    #26262f;
    --border-2:  #2f2f3a;
    --text:      #e9e9ee;
    --text-dim:  #8b8b98;
    --text-dim2: #5c5c68;

    --purple:    #7c6fea;
    --purple-2:  #9186f5;
    --purple-bg: rgba(124,111,234,0.14);

    --green:     #4ade80;
    --green-bg:  rgba(74,222,128,0.12);
    --red:       #f87171;
    --red-bg:    rgba(248,113,113,0.12);
    --amber:     #fbbf24;
    --amber-bg:  rgba(251,191,36,0.12);

    --mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  }

  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; background: var(--bg); color: var(--text); font-family: var(--mono); }

  body{
    background-image:
      linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 28px 28px;
    min-height: 100vh;
  }

  .app{
    max-width: 1040px;
    margin: 36px auto 80px;
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 30px 80px -40px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.02);
    background: var(--panel);
  }

  .titlebar{
    background: var(--panel-2);
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
    display:flex; align-items:center; gap: 10px;
  }
  .dots{ display:flex; gap:7px; }
  .dot{ width:11px; height:11px; border-radius:50%; }
  .dot.r{ background:#ff5f57; }
  .dot.y{ background:#febc2e; }
  .dot.g{ background:#28c840; }
  .titlebar-label{
    flex:1; text-align:center;
    font-size: 11.5px; color: var(--text-dim2);
    letter-spacing: .04em;
  }

  .header{
    padding: 26px 28px 20px;
    border-bottom: 1px solid var(--border);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(124,111,234,0.10), transparent 55%);
  }
  .header-top{ display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  h1{
    font-size: 22px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.01em;
    display:flex; align-items:center; gap:10px;
  }
  h1 img{ width: 22px; height: 22px; border-radius: 6px; }
  .subtitle{ color: var(--text-dim); font-size: 12.5px; margin:0; }
  .run-meta{ color: var(--text-dim2); font-size: 11.5px; margin: 6px 0 0; }
  .run-meta b{ color: var(--text-dim); font-weight: 600; }

  .env-pill{
    font-size: 11px; padding: 5px 11px; border-radius: 6px;
    background: var(--purple-bg); color: var(--purple-2); border: 1px solid rgba(124,111,234,0.35);
    white-space:nowrap;
  }

  .kpis{
    margin-top: 20px;
    display:grid; grid-template-columns: repeat(6,1fr); gap:10px;
  }
  .kpi{
    background: var(--raised); border:1px solid var(--border); border-radius: 8px;
    padding: 12px 13px;
  }
  .kpi-label{ font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color: var(--text-dim2); }
  .kpi-value{ font-size: 19px; font-weight:700; margin-top:4px; }
  .kpi-value.green{ color: var(--green); }
  .kpi-value.red{ color: var(--red); }
  .kpi-value.purple{ color: var(--purple-2); }

  .bar-total{
    margin-top: 12px; height: 6px; border-radius: 4px; overflow:hidden;
    display:flex; background: var(--raised); border:1px solid var(--border);
  }
  .bar-total div{ height:100%; }
  .bt-pass{ background: var(--green); }
  .bt-fail{ background: var(--red); }
  .bt-other{ background: var(--amber); }

  .toolbar{
    padding: 14px 28px;
    border-bottom: 1px solid var(--border);
    display:flex; align-items:center; justify-content:space-between; gap: 14px; flex-wrap: wrap;
    background: var(--panel-2);
  }
  .filter-label{ font-size: 10.5px; letter-spacing:.1em; text-transform:uppercase; color: var(--text-dim2); margin-right: 4px; }
  .filters{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .chip{
    font-family: var(--mono);
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-dim);
    cursor:pointer;
    display:flex; align-items:center; gap:6px;
  }
  .chip:hover{ color: var(--text); background: rgba(255,255,255,0.04); }
  .chip.active{ background: var(--purple); color: #fff; }
  .chip .count{ opacity:.75; font-size:11px; }

  .right-tools{ display:flex; gap:8px; align-items:center; }
  #search{
    font-family: var(--mono); font-size:12.5px;
    background: var(--raised); border:1px solid var(--border); color: var(--text);
    padding: 7px 11px; border-radius: 7px; min-width: 170px;
  }
  #search::placeholder{ color: var(--text-dim2); }
  #search:focus{ outline:none; border-color: var(--purple); }

  .btn{
    font-family: var(--mono); font-size: 12px;
    padding: 7px 13px; border-radius: 7px;
    border: 1px solid var(--border-2);
    background: var(--raised); color: var(--text);
    cursor:pointer;
  }
  .btn:hover{ border-color: var(--purple); color: var(--purple-2); }
  #fileInput{ display:none; }

  .results-meta{
    padding: 14px 28px 0;
    display:flex; justify-content:space-between; align-items:center;
    font-size: 11px; color: var(--text-dim2); letter-spacing:.05em;
  }

  .groups{ padding: 10px 20px 24px; }

  .group{
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 9px;
    margin: 10px 0;
    overflow: hidden;
  }
  .group > summary{
    list-style:none; cursor:pointer;
    padding: 13px 16px;
    display:flex; align-items:center; gap:12px; flex-wrap: wrap;
  }
  .group > summary::-webkit-details-marker{ display:none; }
  .chev{ color: var(--text-dim2); font-size:11px; transition: transform .15s; width:10px; }
  .group[open] .chev{ transform: rotate(90deg); }

  .status-icon{ font-size:13px; font-weight:700; width:16px; text-align:center; }
  .status-icon.passed{ color: var(--green); }
  .status-icon.failed{ color: var(--red); }
  .status-icon.mixed{ color: var(--amber); }
  .status-icon.other{ color: var(--text-dim); }

  .pill-method{
    font-size: 10.5px; font-weight:700; letter-spacing:.03em;
    padding: 2px 8px; border-radius: 5px;
    background: var(--green-bg); color: var(--green);
  }
  .pill-method.post{ background: var(--purple-bg); color: var(--purple-2); }
  .pill-method.put, .pill-method.patch{ background: var(--amber-bg); color: var(--amber); }
  .pill-method.delete{ background: var(--red-bg); color: var(--red); }

  .g-name{ font-size: 13.5px; flex: 1 1 160px; min-width:120px; color: var(--text); }
  .g-runs{ font-size: 11.5px; color: var(--text-dim2); }
  .g-time{ font-size: 11.5px; color: var(--text-dim); }

  .g-verdict{
    font-size: 10.5px; padding: 3px 9px; border-radius: 6px;
    white-space: nowrap;
  }
  .g-verdict.passed{ background: var(--green-bg); color: var(--green); }
  .g-verdict.failed{ background: var(--red-bg); color: var(--red); }
  .g-verdict.mixed{ background: var(--amber-bg); color: var(--amber); }
  .g-verdict.other{ background: var(--raised); color: var(--text-dim); border:1px solid var(--border-2); }

  .group-body{ border-top: 1px solid var(--border); padding: 2px 16px 12px; }

  table{ width:100%; border-collapse: collapse; }
  thead th{
    text-align:left; font-size: 9.5px; letter-spacing:.1em; text-transform:uppercase;
    color: var(--text-dim2); padding: 9px 6px; border-bottom: 1px solid var(--border);
    font-weight: 500;
  }
  tbody td{ padding: 9px 6px; font-size: 12.5px; border-bottom: 1px solid var(--border); vertical-align: middle; color: var(--text); }
  tbody tr:last-child td{ border-bottom:none; }
  tbody tr:hover td{ background: rgba(255,255,255,0.015); }

  .iter{ color: var(--text-dim2); }
  .status-code{ font-weight:600; }
  .status-code.ok{ color: var(--green); }
  .status-code.warn{ color: var(--amber); }
  .status-code.err{ color: var(--red); }

  .status-pill{
    font-size: 10.5px; padding: 3px 9px; border-radius: 5px; display:inline-block;
  }
  .status-pill.passed{ background: var(--green-bg); color: var(--green); }
  .status-pill.failed{ background: var(--red-bg); color: var(--red); }
  .status-pill.other{ background: var(--raised); color: var(--text-dim); border:1px solid var(--border-2); }

  .bar-cell{ display:flex; align-items:center; gap:8px; min-width:150px; }
  .bar-track{ flex:1; height:5px; border-radius:3px; background: var(--raised); border:1px solid var(--border); overflow:hidden; }
  .bar-fill{ height:100%; background: var(--purple); }
  .bar-fill.slow{ background: var(--amber); }
  .bar-fill.veryslow{ background: var(--red); }
  .bar-ms{ font-size: 11px; color: var(--text-dim); width: 54px; text-align:right; }

  .error-row td{ color: var(--red); font-size:11.5px; padding-top:0; }
  .detail-row td{ padding: 4px 6px 12px; border-bottom: 1px solid var(--border); }
  .assertions{ display:flex; flex-direction:column; gap:4px; margin-bottom:8px; }
  .assertion{ font-size:11.5px; }
  .assertion.passed{ color: var(--green); }
  .assertion.failed{ color: var(--red); }
  .assertion-error{ color: var(--text-dim); font-size:11px; padding-left:18px; }
  .detail-label{ font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color: var(--text-dim2); margin: 8px 0 4px; }
  .detail-pre{ margin:0; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 11.5px; white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow-y: auto; }

  .empty{ text-align:center; padding: 60px 20px; color: var(--text-dim); font-size: 13px; }
  .empty strong{ display:block; color: var(--text); font-size:16px; margin-bottom:8px; font-weight:600; }

  .dropzone{
    position: fixed; inset:0; z-index: 50;
    background: rgba(10,10,16,0.9);
    display:none; align-items:center; justify-content:center;
    color: var(--purple-2); font-size: 18px; letter-spacing:.06em;
    border: 2px dashed var(--purple); margin: 14px; border-radius: 12px;
  }
  .dropzone.active{ display:flex; }

  footer{ text-align:center; font-size: 10.5px; color: var(--text-dim2); margin-top: 20px; letter-spacing:.04em; }

  @media (max-width: 720px){
    .kpis{ grid-template-columns: repeat(3,1fr); }
  }
  @media (max-width: 480px){
    .kpis{ grid-template-columns: repeat(2,1fr); }
  }
</style>
</head>
<body>

<div class="dropzone" id="dropzone">Drop JSON to load run</div>

<div class="app">

  <div class="titlebar">
    <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
    <div class="titlebar-label" id="genTime">runner-report</div>
    <div style="width:47px;"></div>
  </div>

  <div class="header">
    <div class="header-top">
      <div>
        <h1><img src="${APP_ICON_DATA_URI}" alt="Relay" /> Relay Runner Report</h1>
        <p class="subtitle" id="subtitle">${subtitle}</p>
        ${
          environmentLabel || runStartedAtLabel
            ? `<p class="run-meta">${[environmentLabel ? `Environment: <b>${environmentLabel}</b>` : "", runStartedAtLabel ? `Run at ${runStartedAtLabel}` : ""].filter(Boolean).join(" &middot; ")}</p>`
            : ""
        }
      </div>
      <div class="env-pill" id="metaVerdict">&mdash;</div>
    </div>

    <div class="kpis" id="statStrip"></div>
    <div class="bar-total" id="distribution"></div>
  </div>

  <div class="toolbar">
    <div class="filters" id="filters">
      <span class="filter-label">Filter by</span>
      <button class="chip active" data-filter="all">All</button>
      <button class="chip" data-filter="passed">Passed</button>
      <button class="chip" data-filter="failed">Failed</button>
      <button class="chip" data-filter="other">Other</button>
    </div>
    <div class="right-tools">
      <input type="text" id="search" placeholder="Search requests&hellip;">
      <label class="btn" for="fileInput">Load JSON</label>
      <input type="file" id="fileInput" accept="application/json,.json">
    </div>
  </div>

  <div class="results-meta">
    <span id="resultsCount">Showing 0 of 0</span>
    <span>Ordered by first appearance</span>
  </div>

  <div class="groups" id="groups"></div>

</div>

<footer>Generated by Relay &middot; no data leaves this page</footer>

<script>
(function(){
  var state = { data: [], filter: 'all', search: '' };

  function escapeHtml(str){
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function normalize(status){
    var s = (status || '').toLowerCase();
    if (s === 'passed' || s === 'pass') return 'passed';
    if (s === 'failed' || s === 'fail') return 'failed';
    return s || 'unknown';
  }

  function methodClass(method){
    var m = (method || '').toLowerCase();
    if (m === 'post') return 'post';
    if (m === 'put' || m === 'patch') return m;
    if (m === 'delete') return 'delete';
    return '';
  }

  function statusCodeClass(code){
    if (!code) return 'err';
    if (code >= 200 && code < 300) return 'ok';
    if (code >= 300 && code < 400) return 'warn';
    return 'err';
  }

  function groupData(data){
    var order = [], map = {};
    data.forEach(function(item){
      var key = item.name || '(unnamed request)';
      if (!map[key]){ map[key] = []; order.push(key); }
      map[key].push(item);
    });
    return order.map(function(key){
      var items = map[key].slice().sort(function(a,b){ return (a.iteration||0) - (b.iteration||0); });
      var times = items.map(function(i){ return typeof i.timeMs === 'number' ? i.timeMs : null; }).filter(function(t){ return t !== null; });
      var passed = items.filter(function(i){ return normalize(i.status) === 'passed'; }).length;
      var failed = items.filter(function(i){ return normalize(i.status) === 'failed'; }).length;
      var overall = failed > 0 ? (passed > 0 ? 'mixed' : 'failed') : (passed === items.length ? 'passed' : 'other');
      return {
        name: key, method: items[0].method || '', items: items, count: items.length,
        passed: passed, failed: failed,
        min: times.length ? Math.min.apply(null, times) : null,
        max: times.length ? Math.max.apply(null, times) : null,
        avg: times.length ? Math.round(times.reduce(function(a,b){return a+b;},0) / times.length) : null,
        overall: overall
      };
    });
  }

  function computeStats(data){
    var total = data.length;
    var passed = data.filter(function(i){ return normalize(i.status) === 'passed'; }).length;
    var failed = data.filter(function(i){ return normalize(i.status) === 'failed'; }).length;
    var other = total - passed - failed;
    var times = data.map(function(i){ return typeof i.timeMs === 'number' ? i.timeMs : null; }).filter(function(t){ return t !== null; });
    var avg = times.length ? Math.round(times.reduce(function(a,b){return a+b;},0)/times.length) : 0;
    var sum = times.length ? times.reduce(function(a,b){return a+b;},0) : 0;
    var slowest = times.length ? data.filter(function(i){return i.timeMs === Math.max.apply(null,times);})[0] : null;
    return { total: total, passed: passed, failed: failed, other: other, avg: avg, sum: sum, slowest: slowest,
      passRate: total ? Math.round((passed/total)*1000)/10 : 0 };
  }

  function renderStats(stats, requestCount){
    document.getElementById('genTime').textContent = 'runner-report  \\u2014  ' + new Date().toLocaleString();

    var verdictEl = document.getElementById('metaVerdict');
    if (stats.total === 0){
      verdictEl.textContent = 'No data';
      verdictEl.style.color = 'var(--text-dim)';
    } else if (stats.failed === 0){
      verdictEl.textContent = '\\u2713 All Passed';
      verdictEl.style.color = '';
    } else {
      verdictEl.textContent = '\\u2715 ' + stats.failed + ' Failing';
    }

    var stripHtml =
      '<div class="kpi"><div class="kpi-label">Requests</div><div class="kpi-value">' + requestCount + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Executions</div><div class="kpi-value">' + stats.total + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Passed</div><div class="kpi-value green">' + stats.passed + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Failed</div><div class="kpi-value red">' + stats.failed + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Pass Rate</div><div class="kpi-value purple">' + stats.passRate + '%</div></div>' +
      '<div class="kpi"><div class="kpi-label">Avg Time</div><div class="kpi-value">' + stats.avg + '<span style="font-size:11px;color:var(--text-dim);">ms</span></div></div>';
    document.getElementById('statStrip').innerHTML = stripHtml;

    var dist = document.getElementById('distribution');
    if (stats.total === 0){ dist.innerHTML = ''; return; }
    var pPct = (stats.passed/stats.total*100), fPct = (stats.failed/stats.total*100), oPct = (stats.other/stats.total*100);
    dist.innerHTML =
      (pPct ? '<div class="bt-pass" style="width:'+pPct+'%"></div>' : '') +
      (fPct ? '<div class="bt-fail" style="width:'+fPct+'%"></div>' : '') +
      (oPct ? '<div class="bt-other" style="width:'+oPct+'%"></div>' : '');
  }

  function timeBarClass(ms){
    if (ms > 3000) return 'veryslow';
    if (ms > 1000) return 'slow';
    return '';
  }

  function renderGroups(){
    var groups = groupData(state.data);
    var maxTime = Math.max.apply(null, state.data.map(function(i){ return typeof i.timeMs === 'number' ? i.timeMs : 0; }).concat([1]));

    var filtered = groups.filter(function(g){
      if (state.search && g.name.toLowerCase().indexOf(state.search.toLowerCase()) === -1) return false;
      if (state.filter === 'all') return true;
      if (state.filter === 'passed') return g.items.some(function(i){ return normalize(i.status) === 'passed'; });
      if (state.filter === 'failed') return g.items.some(function(i){ return normalize(i.status) === 'failed'; });
      if (state.filter === 'other') return g.items.some(function(i){ var n = normalize(i.status); return n !== 'passed' && n !== 'failed'; });
      return true;
    });

    var shownExecCount = filtered.reduce(function(sum,g){ return sum + g.items.length; }, 0);
    document.getElementById('resultsCount').textContent = 'Showing ' + shownExecCount + ' of ' + state.data.length;

    var container = document.getElementById('groups');

    if (state.data.length === 0){
      container.innerHTML = '<div class="empty"><strong>No run loaded</strong>Load a result JSON file to preview the report.</div>';
      return;
    }
    if (filtered.length === 0){
      container.innerHTML = '<div class="empty"><strong>No matches</strong>Nothing here matches the current filter or search.</div>';
      return;
    }

    container.innerHTML = filtered.map(function(g){
      var rowsToShow = state.filter === 'all' ? g.items : g.items.filter(function(i){
        var n = normalize(i.status);
        if (state.filter === 'other') return n !== 'passed' && n !== 'failed';
        return n === state.filter;
      });

      var rows = rowsToShow.map(function(item){
        var ms = typeof item.timeMs === 'number' ? item.timeMs : 0;
        var pct = Math.max(4, Math.round((ms / maxTime) * 100));
        var barClass = timeBarClass(ms);
        var norm = normalize(item.status);
        var codeClass = statusCodeClass(item.statusCode);
        var rowHtml =
          '<tr>' +
            '<td class="iter">#' + item.iteration + '</td>' +
            '<td><span class="status-pill ' + (norm==='passed'?'passed':norm==='failed'?'failed':'other') + '">' + escapeHtml(item.status || 'unknown') + '</span></td>' +
            '<td class="status-code ' + codeClass + '">' + (item.statusCode !== null && item.statusCode !== undefined ? item.statusCode : '&mdash;') + '</td>' +
            '<td>' +
              '<div class="bar-cell">' +
                '<div class="bar-track"><div class="bar-fill ' + barClass + '" style="width:' + pct + '%"></div></div>' +
                '<div class="bar-ms">' + ms + 'ms</div>' +
              '</div>' +
            '</td>' +
          '</tr>';
        if (item.error){
          rowHtml += '<tr class="error-row"><td></td><td colspan="3">&#8618; ' + escapeHtml(item.error) + '</td></tr>';
        }
        var assertions = Array.isArray(item.assertions) ? item.assertions : [];
        var detailParts = [];
        if (assertions.length){
          detailParts.push('<div class="assertions">' + assertions.map(function(a){
            return '<div class="assertion ' + (a.passed ? 'passed' : 'failed') + '">' +
              '<span>' + (a.passed ? '\\u2713' : '\\u2715') + '</span> ' + escapeHtml(a.name) +
              (!a.passed && a.error ? '<div class="assertion-error">' + escapeHtml(a.error) + '</div>' : '') +
              '</div>';
          }).join('') + '</div>');
        }
        if (item.requestBody){
          detailParts.push('<div class="detail-label">Request Body</div><pre class="detail-pre">' + escapeHtml(item.requestBody) + '</pre>');
        }
        if (item.responseBody){
          detailParts.push('<div class="detail-label">Response Body</div><pre class="detail-pre">' + escapeHtml(item.responseBody) + '</pre>');
        }
        if (detailParts.length){
          rowHtml += '<tr class="detail-row"><td colspan="4">' + detailParts.join('') + '</td></tr>';
        }
        return rowHtml;
      }).join('');

      var timingLabel = g.min === g.max ? (g.avg + 'ms') : (g.min + '&ndash;' + g.max + 'ms avg ' + g.avg + 'ms');
      var icon = g.overall === 'passed' ? '\\u2713' : g.overall === 'failed' ? '\\u2715' : g.overall === 'mixed' ? '!' : '\\u2022';

      return (
        '<details class="group" ' + (g.overall === 'failed' || g.overall === 'mixed' ? 'open' : '') + '>' +
          '<summary>' +
            '<span class="chev">&#9656;</span>' +
            '<span class="status-icon ' + g.overall + '">' + icon + '</span>' +
            '<span class="pill-method ' + methodClass(g.method) + '">' + escapeHtml(g.method) + '</span>' +
            '<span class="g-name">' + escapeHtml(g.name) + '</span>' +
            '<span class="g-runs">' + g.count + ' run' + (g.count !== 1 ? 's' : '') + '</span>' +
            '<span class="g-time">' + timingLabel + '</span>' +
            '<span class="g-verdict ' + g.overall + '">' +
              (g.overall === 'passed' ? 'All Passed' : g.overall === 'failed' ? 'All Failed' : g.overall === 'mixed' ? g.failed + '/' + g.count + ' Failed' : 'Mixed') +
            '</span>' +
          '</summary>' +
          '<div class="group-body">' +
            '<table>' +
              '<thead><tr><th>Iter</th><th>Status</th><th>Code</th><th>Response Time</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</details>'
      );
    }).join('');
  }

  function loadData(input){
    var data = Array.isArray(input) ? input : (input && Array.isArray(input.results) ? input.results : null);
    if (!data || data.length === 0){
      document.getElementById('groups').innerHTML =
        '<div class="empty"><strong>Could not read run</strong>Expected a JSON array of test result objects (or a { results: [...] } object).</div>';
      return;
    }
    if (input && !Array.isArray(input)){
      if (input.environment || input.runStartedAt){
        var metaEl = document.getElementById('subtitle').parentNode.querySelector('.run-meta');
        var parts = [];
        if (input.environment) parts.push('Environment: <b>' + escapeHtml(input.environment) + '</b>');
        if (input.runStartedAt) parts.push('Run at ' + escapeHtml(new Date(input.runStartedAt).toLocaleString()));
        if (!metaEl){
          metaEl = document.createElement('p');
          metaEl.className = 'run-meta';
          document.getElementById('subtitle').insertAdjacentElement('afterend', metaEl);
        }
        metaEl.innerHTML = parts.join(' &middot; ');
      }
    }
    state.data = data;
    var groups = groupData(data);
    var stats = computeStats(data);
    renderStats(stats, groups.length);
    renderGroups();
  }

  document.getElementById('filters').addEventListener('click', function(e){
    var btn = e.target.closest('.chip');
    if (!btn) return;
    document.querySelectorAll('.chip').forEach(function(c){ c.classList.remove('active'); });
    btn.classList.add('active');
    state.filter = btn.getAttribute('data-filter');
    renderGroups();
  });

  document.getElementById('search').addEventListener('input', function(e){
    state.search = e.target.value;
    renderGroups();
  });

  document.getElementById('fileInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(evt){
      try{ loadData(JSON.parse(evt.target.result)); }
      catch(err){
        document.getElementById('groups').innerHTML =
          '<div class="empty"><strong>Invalid JSON</strong>' + escapeHtml(err.message) + '</div>';
      }
    };
    reader.readAsText(file);
  });

  var dropzone = document.getElementById('dropzone');
  var dragCounter = 0;
  window.addEventListener('dragenter', function(e){ e.preventDefault(); dragCounter++; dropzone.classList.add('active'); });
  window.addEventListener('dragover', function(e){ e.preventDefault(); });
  window.addEventListener('dragleave', function(e){ dragCounter--; if (dragCounter <= 0){ dropzone.classList.remove('active'); dragCounter = 0; } });
  window.addEventListener('drop', function(e){
    e.preventDefault(); dragCounter = 0; dropzone.classList.remove('active');
    var file = e.dataTransfer.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(evt){
      try{ loadData(JSON.parse(evt.target.result)); }
      catch(err){
        document.getElementById('groups').innerHTML =
          '<div class="empty"><strong>Invalid JSON</strong>' + escapeHtml(err.message) + '</div>';
      }
    };
    reader.readAsText(file);
  });

  loadData(${embeddedData});
})();
</script>

</body>
</html>`;
}
