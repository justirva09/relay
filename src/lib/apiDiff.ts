import { AuthConfig, KVRow, RequestData, normalizeRequestData } from "../types";

export type DiffCategory = "method" | "url" | "auth" | "query" | "header" | "body";

export interface DiffLine {
  kind: "added" | "removed" | "changed";
  category: DiffCategory;
  text: string;
  before?: string;
  after?: string;
  sensitive?: boolean;
  // true = already on HEAD, false = only in the working tree. Undefined when
  // it doesn't apply (branch-vs-branch, or added/removed entries).
  committed?: boolean;
}

// url includes the query string, so comparing full urls double-counts every
// query param edit as a "URL changed" issue too. Only the base path
// identifies the endpoint; query changes are covered by diffRows.
function urlBase(url: string): string {
  const qIndex = url.indexOf("?");
  return qIndex === -1 ? url : url.slice(0, qIndex);
}

function authSummary(auth: AuthConfig): string {
  if (auth.type === "bearer") return `Bearer ${auth.bearer?.token || ""}`;
  if (auth.type === "basic") return `Basic ${auth.basic?.username || ""}`;
  return "No Auth";
}

// Just a naming heuristic, not a hard rule. Query strings leak into logs,
// browser history, and proxies way more than headers do.
const SENSITIVE_KEY = /token|secret|password|api[_-]?key|auth/i;

function diffRows(before: KVRow[], after: KVRow[], label: string, category: DiffCategory): DiffLine[] {
  const beforeMap = new Map(before.filter((r) => r.enabled && r.key.trim()).map((r) => [r.key.toLowerCase(), r]));
  const afterMap = new Map(after.filter((r) => r.enabled && r.key.trim()).map((r) => [r.key.toLowerCase(), r]));
  const lines: DiffLine[] = [];
  for (const [k, r] of afterMap) {
    const prev = beforeMap.get(k);
    const sensitive = category === "query" && SENSITIVE_KEY.test(r.key);
    if (!prev) lines.push({ kind: "added", category, text: `+ ${label}: ${r.key}=${r.value}`, after: `${r.key}=${r.value}`, sensitive });
    else if (prev.value !== r.value)
      lines.push({ kind: "changed", category, text: `${label} ${r.key}: ${prev.value} → ${r.value}`, before: prev.value, after: r.value, sensitive });
  }
  for (const [k, r] of beforeMap) {
    if (!afterMap.has(k)) lines.push({ kind: "removed", category, text: `- ${label}: ${r.key}`, before: `${r.key}=${r.value}` });
  }
  return lines;
}

// Diffs two request versions into human-readable lines instead of a raw
// JSON diff.
export function diffRequestData(before: RequestData, after: RequestData): DiffLine[] {
  const lines: DiffLine[] = [];

  if (before.method !== after.method)
    lines.push({ kind: "changed", category: "method", text: `method: ${before.method} → ${after.method}`, before: before.method, after: after.method });
  const beforeBase = urlBase(before.url);
  const afterBase = urlBase(after.url);
  if (beforeBase !== afterBase)
    lines.push({ kind: "changed", category: "url", text: `url: ${beforeBase} → ${afterBase}`, before: beforeBase, after: afterBase });

  const beforeAuth = authSummary(before.auth);
  const afterAuth = authSummary(after.auth);
  if (beforeAuth !== afterAuth)
    lines.push({ kind: "changed", category: "auth", text: `auth: ${beforeAuth} → ${afterAuth}`, before: beforeAuth, after: afterAuth });

  lines.push(...diffRows(before.params, after.params, "query", "query"));
  lines.push(...diffRows(before.headers, after.headers, "header", "header"));

  if (before.bodyMode !== after.bodyMode) {
    lines.push({ kind: "changed", category: "body", text: `body mode: ${before.bodyMode} → ${after.bodyMode}`, before: before.bodyMode, after: after.bodyMode });
  } else if (before.bodyMode === "json" || before.bodyMode === "text") {
    if (before.bodyText !== after.bodyText) lines.push({ kind: "changed", category: "body", text: "body content changed", before: before.bodyText, after: after.bodyText });
  } else if (before.bodyMode === "form-data") {
    if (JSON.stringify(before.bodyForm) !== JSON.stringify(after.bodyForm)) lines.push({ kind: "changed", category: "body", text: "body form fields changed" });
  } else if (before.bodyMode === "urlencoded") {
    if (JSON.stringify(before.bodyUrlencoded) !== JSON.stringify(after.bodyUrlencoded)) lines.push({ kind: "changed", category: "body", text: "body fields changed" });
  }

  return lines;
}

export interface HistoryTimelineEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
  diffLines: DiffLine[] | null; // null = the commit that created this request
}

// git log is newest-first; each commit diffs against the version it
// replaced, so the oldest entry (creation) has none.
export function buildHistoryTimeline(entries: { hash: string; author: string; date: string; message: string; content: string | null }[]): HistoryTimelineEntry[] {
  return entries.map((entry, i) => {
    const older = entries[i + 1];
    if (!older || !entry.content) {
      return { hash: entry.hash, author: entry.author, date: entry.date, message: entry.message, diffLines: null };
    }
    let diffLines: DiffLine[] | null = null;
    try {
      const beforeReq: RequestData = normalizeRequestData(JSON.parse(older.content!).request);
      const afterReq: RequestData = normalizeRequestData(JSON.parse(entry.content).request);
      diffLines = diffRequestData(beforeReq, afterReq);
    } catch {
      diffLines = null;
    }
    return { hash: entry.hash, author: entry.author, date: entry.date, message: entry.message, diffLines };
  });
}

export interface BranchRequestDiff {
  path: string;
  folder: string;
  status: "added" | "removed" | "modified";
  name: string;
  method: string;
  url: string;
  diffLines: DiffLine[];
  breaking: boolean;
  breakingReasons: string[];
  // After-state for added/modified, before-state for removed. Only one
  // side exists then, so there's nothing to diff.
  snapshot: RequestData | null;
  // gRPC requests don't have the HTTP fields this diff engine assumes
  // (auth, headers, bodyMode), so they get whole-file treatment instead of
  // running through HTTP-shaped logic that would crash on them.
  kind: "http" | "grpc";
  // Kept for modified entries so the UI can lazily fetch HEAD on expand and
  // tag committed vs uncommitted. Bulk fetch skips HEAD to stay fast.
  beforeReq: RequestData | null;
  afterReq: RequestData | null;
}

// Path is relative to workspace root with the storage layer's .relay/
// prefix, e.g. ".relay/github-api/search.relay". Good enough for a grouping
// label without asking Rust to walk the real tree.
function folderOf(path: string): string {
  const segments = path.split("/").filter((s) => s && s !== ".relay");
  segments.pop();
  return segments.join("/") || "—";
}

// Collects every reason that applies, since a request can change method AND
// url AND leak a secret all at once, instead of stopping at the first match.
function describeBreaking(status: BranchRequestDiff["status"], before: RequestData | null, after: RequestData | null, diffLines: DiffLine[]): string[] {
  const reasons: string[] = [];
  if (status === "removed") {
    reasons.push("This request was deleted — apps still calling it will get a \"not found\" error.");
  } else if (before && after) {
    if (before.method !== after.method)
      reasons.push(`Method changed from ${before.method} to ${after.method} — apps still sending ${before.method} will fail.`);
    if (urlBase(before.url) !== urlBase(after.url)) reasons.push("The URL changed — apps still using the old URL will get a \"not found\" error.");
    if (before.auth.type === "none" && after.auth.type !== "none")
      reasons.push("This now requires login credentials — apps that don't send them will start failing.");
  }

  const sensitiveKeys = diffLines.filter((l) => l.sensitive && l.kind !== "removed").map((l) => l.text.split("=")[0].replace(/^\+?\s*query:\s*/, ""));
  if (sensitiveKeys.length) {
    reasons.push(`${sensitiveKeys.join(", ")} is now visible in the URL — this can leak through browser history, server logs, or shared links.`);
  }

  return reasons;
}

// Marks each diff line as committed (also present in base-vs-HEAD) or not.
// Matched by kind+category+text since DiffLine has no stable id.
export function tagCommitted(diffLines: DiffLine[], beforeReq: RequestData, headReq: RequestData): DiffLine[] {
  const committedLines = diffRequestData(beforeReq, headReq);
  const isCommitted = (l: DiffLine) => committedLines.some((c) => c.kind === l.kind && c.category === l.category && c.text === l.text);
  return diffLines.map((l) => ({ ...l, committed: isCommitted(l) }));
}

export interface BranchDiffSummary {
  added: number;
  modified: number;
  removed: number;
  breaking: BranchRequestDiff[];
  safe: BranchRequestDiff[];
}

// Best-effort breaking check. Relay doesn't version response shapes, so this
// only looks at the request definition itself: the endpoint disappearing,
// method/URL changing, or auth newly required. Everything else (removing
// auth, query/header/body changes) is treated as safe.
function isBreaking(status: BranchRequestDiff["status"], before: RequestData | null, after: RequestData | null): boolean {
  if (status === "removed") return true;
  if (status === "added") return false;
  if (!before || !after) return false;
  if (before.method !== after.method) return true;
  if (urlBase(before.url) !== urlBase(after.url)) return true;
  if (before.auth.type === "none" && after.auth.type !== "none") return true;
  return false;
}

// Parses each side's raw content (null for add/remove) and builds the
// breaking/safe split for the whole branch compare.
export function buildBranchDiffSummary(
  entries: { path: string; status: "added" | "removed" | "modified"; before: string | null; after: string | null; head?: string | null }[]
): BranchDiffSummary {
  const breaking: BranchRequestDiff[] = [];
  const safe: BranchRequestDiff[] = [];
  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const entry of entries) {
    let beforeParsed: any = null;
    let afterParsed: any = null;
    let name = entry.path;
    try {
      if (entry.before) {
        beforeParsed = JSON.parse(entry.before);
        name = beforeParsed.name || name;
      }
      if (entry.after) {
        afterParsed = JSON.parse(entry.after);
        name = afterParsed.name || name;
      }
    } catch {
      continue;
    }

    const isGrpc = beforeParsed?.kind === "grpc" || afterParsed?.kind === "grpc";

    if (isGrpc) {
      const grpcReq = afterParsed?.request ?? beforeParsed?.request;
      const isEntryBreaking = entry.status === "removed";
      const result: BranchRequestDiff = {
        path: entry.path,
        folder: folderOf(entry.path),
        status: entry.status,
        name,
        method: "gRPC",
        url: grpcReq ? `${grpcReq.service} / ${grpcReq.method}` : "",
        diffLines: [],
        breaking: isEntryBreaking,
        breakingReasons: isEntryBreaking ? ["This gRPC request was deleted — clients still calling it will fail."] : [],
        snapshot: null,
        kind: "grpc",
        beforeReq: null,
        afterReq: null,
      };
      if (entry.status === "added") added++;
      else if (entry.status === "removed") removed++;
      else modified++;
      (isEntryBreaking ? breaking : safe).push(result);
      continue;
    }

    // Old commits can predate fields added later (auth, examples,
    // pathParams). Normalize so an old request doesn't crash on a field
    // that just isn't there yet.
    const beforeReq: RequestData | null = beforeParsed?.request ? normalizeRequestData(beforeParsed.request) : null;
    const afterReq: RequestData | null = afterParsed?.request ? normalizeRequestData(afterParsed.request) : null;

    let diffLines = beforeReq && afterReq ? diffRequestData(beforeReq, afterReq) : [];
    if (beforeReq && afterReq && entry.head) {
      try {
        const headReq: RequestData = normalizeRequestData(JSON.parse(entry.head).request);
        diffLines = tagCommitted(diffLines, beforeReq, headReq);
      } catch {
        // HEAD unreadable, leave lines untagged.
      }
    }
    const isEntryBreaking = isBreaking(entry.status, beforeReq, afterReq);
    const result: BranchRequestDiff = {
      path: entry.path,
      folder: folderOf(entry.path),
      status: entry.status,
      name,
      method: (afterReq ?? beforeReq)?.method ?? "",
      url: (afterReq ?? beforeReq)?.url ?? "",
      diffLines,
      kind: "http",
      breaking: isEntryBreaking,
      breakingReasons: isEntryBreaking ? describeBreaking(entry.status, beforeReq, afterReq, diffLines) : [],
      snapshot: afterReq ?? beforeReq,
      beforeReq,
      afterReq,
    };

    if (entry.status === "added") added++;
    else if (entry.status === "removed") removed++;
    else modified++;

    (isEntryBreaking ? breaking : safe).push(result);
  }

  return { added, modified, removed, breaking, safe };
}
