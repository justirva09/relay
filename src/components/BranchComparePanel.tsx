import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../store";
import { gitListBranches, gitBranchDiff, gitStatus } from "../lib/tauri";
import { buildBranchDiffSummary, BranchDiffSummary, BranchRequestDiff, DiffCategory, DiffLine } from "../lib/apiDiff";
import SimpleSelect from "./SimpleSelect";

const DIFF_COLOR: Record<DiffLine["kind"], string> = {
  added: "text-emerald-400",
  removed: "text-rose-400",
  changed: "text-amber-400",
};

const STATUS_BADGE: Record<BranchRequestDiff["status"], string> = {
  added: "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30",
  removed: "text-rose-400 bg-rose-400/10 ring-rose-400/30",
  modified: "text-amber-400 bg-amber-400/10 ring-amber-400/30",
};

const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-rose-400",
  HEAD: "text-th-text-3",
  OPTIONS: "text-th-text-3",
};

const CATEGORY_LABEL: Record<DiffCategory, string> = {
  method: "Method",
  url: "URL",
  auth: "Auth",
  query: "Query",
  header: "Headers",
  body: "Body",
};
const CATEGORY_ORDER: DiffCategory[] = ["method", "url", "auth", "query", "header", "body"];

const FILTERS: { key: DiffCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "method", label: "Method" },
  { key: "url", label: "URL" },
  { key: "auth", label: "Auth" },
  { key: "query", label: "Query" },
  { key: "header", label: "Header" },
  { key: "body", label: "Body" },
];

function matchesFilter(entry: BranchRequestDiff, filter: DiffCategory | "all"): boolean {
  if (filter === "all") return true;
  if (entry.status !== "modified") return true; // an add/remove touches every field, not just one category
  return entry.diffLines.some((l) => l.category === filter);
}

function MethodChip({ method }: { method: string }) {
  return <span className={`font-mono text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-th-surface ${METHOD_COLOR[method] || "text-th-text-3"}`}>{method}</span>;
}

function CommittedTag({ committed }: { committed?: boolean }) {
  if (committed === undefined) return null;
  return committed ? (
    <span className="shrink-0 ml-1 text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-th-surface text-th-text-4 border border-th-border">committed</span>
  ) : (
    <span className="shrink-0 ml-1 text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300">uncommitted</span>
  );
}

function DiffLineView({ line }: { line: DiffLine }) {
  if (line.before !== undefined && line.after !== undefined) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="flex items-start gap-1.5 px-1.5 py-0.5 rounded bg-rose-400/10 text-rose-300 line-through decoration-rose-400/50">
          <span className="shrink-0 opacity-70">−</span>
          <span className="break-all">{line.before}</span>
        </span>
        <span className="flex items-start gap-1.5 px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-300">
          <span className="shrink-0 opacity-70">+</span>
          <span className="break-all">{line.after}</span>
          {line.sensitive && (
            <span className="shrink-0 ml-1 text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-rose-400/20 text-rose-300">exposes secret</span>
          )}
          <CommittedTag committed={line.committed} />
        </span>
      </div>
    );
  }
  return (
    <span className={`flex items-start gap-1.5 px-1.5 py-0.5 rounded ${line.kind === "added" ? "bg-emerald-400/10" : "bg-rose-400/10"} ${DIFF_COLOR[line.kind]}`}>
      <span className="shrink-0 opacity-70">{line.kind === "added" ? "+" : "−"}</span>
      <span className="break-all">{line.after ?? line.before ?? line.text}</span>
      {line.sensitive && (
        <span className="shrink-0 ml-1 text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-rose-400/20 text-rose-300">exposes secret</span>
      )}
      <CommittedTag committed={line.committed} />
    </span>
  );
}

function SnapshotView({ entry }: { entry: BranchRequestDiff }) {
  const req = entry.snapshot;
  if (!req) return null;
  const label = entry.status === "added" ? "new" : "removed";
  return (
    <div className="flex flex-col gap-2.5 text-[11.5px] font-mono">
      <div className="grid grid-cols-[70px_1fr] gap-2">
        <span className="text-th-text-4 text-[10px] uppercase tracking-wide font-bold pt-0.5">Method</span>
        <span className="text-emerald-300">{req.method}</span>
      </div>
      <div className="grid grid-cols-[70px_1fr] gap-2">
        <span className="text-th-text-4 text-[10px] uppercase tracking-wide font-bold pt-0.5">URL</span>
        <span className="text-emerald-300 break-all">{req.url || <em className="text-rose-300 not-italic">no URL set</em>}</span>
      </div>
      <div className="grid grid-cols-[70px_1fr] gap-2">
        <span className="text-th-text-4 text-[10px] uppercase tracking-wide font-bold pt-0.5">Auth</span>
        <span className="text-th-text-2">{req.auth.type === "none" ? "none" : req.auth.type}</span>
      </div>
      <div className="grid grid-cols-[70px_1fr] gap-2">
        <span className="text-th-text-4 text-[10px] uppercase tracking-wide font-bold pt-0.5">Body</span>
        <span className="text-th-text-2">mode: {req.bodyMode}</span>
      </div>
      <p className="text-th-text-4 italic">this endpoint is {label} on this side of the comparison</p>
    </div>
  );
}

function EntryCard({
  entry,
  filter,
  expanded,
  onToggle,
}: {
  entry: BranchRequestDiff;
  filter: DiffCategory | "all";
  expanded: boolean;
  onToggle: () => void;
}) {
  const grouped = useMemo(() => {
    const groups: { category: DiffCategory; lines: DiffLine[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      if (filter !== "all" && filter !== cat) continue;
      const lines = entry.diffLines.filter((l) => l.category === cat);
      if (lines.length) groups.push({ category: cat, lines });
    }
    return groups;
  }, [entry.diffLines, filter]);

  return (
    <div className={`border rounded-lg bg-th-surface overflow-hidden shrink-0 ${entry.breaking ? "border-rose-400/40" : "border-th-border"}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-th-hover">
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold ring-1 uppercase ${STATUS_BADGE[entry.status]}`}>
          {entry.status === "modified" ? "mod" : entry.status}
        </span>
        <MethodChip method={entry.method} />
        <span className="text-[13px] font-medium text-th-text-1 shrink-0 max-w-[160px] truncate">{entry.name}</span>
        <span className="text-[12px] font-mono text-th-text-3 truncate flex-1 min-w-0">{entry.url || <em className="text-rose-400 not-italic">no URL set</em>}</span>
        {entry.breaking && (
          <span className="shrink-0 text-[10px] font-mono font-semibold text-rose-400 bg-rose-400/10 rounded-full px-2 py-0.5">breaking</span>
        )}
        <svg
          width="13"
          height="13"
          viewBox="0 0 10 10"
          className={`shrink-0 text-th-text-3 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-th-border px-3.5 py-3 flex flex-col gap-3">
          {entry.kind === "grpc" ? (
            <p className="text-[11.5px] font-mono text-th-text-4 italic">gRPC request — field-level diff isn't supported yet, this commits/compares the whole file.</p>
          ) : entry.status !== "modified" ? (
            <SnapshotView entry={entry} />
          ) : (
            grouped.map((g) => (
              <div key={g.category} className="grid grid-cols-[70px_1fr] gap-2 text-[11.5px] font-mono">
                <span className="text-th-text-4 text-[10px] uppercase tracking-wide font-bold pt-0.5">{CATEGORY_LABEL[g.category]}</span>
                <div className="flex flex-col gap-1">
                  {g.lines.map((l, i) => (
                    <DiffLineView key={i} line={l} />
                  ))}
                </div>
              </div>
            ))
          )}
          {entry.breaking && entry.breakingReasons.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {entry.breakingReasons.map((reason, i) => (
                <div key={i} className="flex items-start gap-2 bg-rose-400/10 border border-rose-400/25 rounded-md px-3 py-2 text-[12px] text-rose-200 leading-relaxed">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-rose-400 mt-0.5">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BranchComparePanel({ onClose }: { onClose: () => void }) {
  const { workspaceDir } = useWorkspace();
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [compare, setCompare] = useState("");
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [summary, setSummary] = useState<BranchDiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DiffCategory | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!workspaceDir) return;
    Promise.all([gitListBranches(workspaceDir), gitStatus(workspaceDir)]).then(([list, status]) => {
      setBranches(list);
      setCurrentBranch(status?.branch ?? null);
      setBase((prev) => {
        if (prev) return prev;
        const current = status?.branch ?? list[0] ?? "";
        const other = list.find((b) => b !== current) ?? current;
        return list.includes("main") && "main" !== current ? "main" : other;
      });
      setCompare((prev) => prev || status?.branch || list[0] || "");
      setInitialized(true);
    });
  }, [workspaceDir]);

  // The "compare" side is only ever a committed ref UNLESS it's the branch
  // you're actually sitting on right now — in that case comparing to the ref
  // alone would silently ignore whatever you're mid-edit on, so this reads
  // the working tree instead (staged + unstaged combined), same reasoning as
  // VSCode's Source Control diff always reflecting what's really on disk.
  const refreshDiff = useCallback(() => {
    if (!workspaceDir || !base || !compare) return;
    setLoading(true);
    setError(null);
    const compareArg = compare === currentBranch ? null : compare;
    gitBranchDiff(workspaceDir, base, compareArg)
      .then((entries) => setSummary(buildBranchDiffSummary(entries)))
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false));
  }, [workspaceDir, base, compare, currentBranch]);

  useEffect(() => {
    if (!initialized) return;
    refreshDiff();
  }, [initialized, refreshDiff]);

  // Sync without closing/reopening: re-fetch when the window regains focus
  // (e.g. you committed in a terminal, or switched branches elsewhere) —
  // same pattern GitPanel's own status refresh already uses — plus a manual
  // button for a same-window commit (no focus change happens for that).
  useEffect(() => {
    const onFocus = () => refreshDiff();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshDiff]);

  const branchOptions = useMemo(() => branches.map((b) => ({ value: b, label: b })), [branches]);
  const allEntries = useMemo(() => (summary ? [...summary.breaking, ...summary.safe] : []), [summary]);
  const visibleEntries = useMemo(() => allEntries.filter((e) => matchesFilter(e, filter)), [allEntries, filter]);
  const totalChanged = summary ? summary.added + summary.modified + summary.removed : 0;

  const categoryCounts = useMemo(() => {
    const counts: Record<DiffCategory, number> = { method: 0, url: 0, auth: 0, query: 0, header: 0, body: 0 };
    for (const e of allEntries) {
      if (e.status !== "modified") continue;
      for (const cat of new Set(e.diffLines.map((l) => l.category))) counts[cat]++;
    }
    return counts;
  }, [allEntries]);

  const groupedByFolder = useMemo(() => {
    const map = new Map<string, BranchRequestDiff[]>();
    for (const e of visibleEntries) {
      if (!map.has(e.folder)) map.set(e.folder, []);
      map.get(e.folder)!.push(e);
    }
    return Array.from(map.entries());
  }, [visibleEntries]);

  const handleFilterChange = (f: DiffCategory | "all") => {
    setFilter(f);
    if (f !== "all") {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const e of allEntries) if (matchesFilter(e, f)) next.add(e.path);
        return next;
      });
    }
  };

  const toggleCard = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-4 border-b border-th-border flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[16px] font-semibold text-th-text-1">Compare Branches</h1>
          <p className="text-[12px] text-th-text-3 mt-0.5">Reviewing request-level changes between two branches</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            title="Refresh"
            onClick={refreshDiff}
            disabled={loading}
            className="text-th-text-3 hover:text-th-text-1 w-7 h-7 grid place-items-center rounded hover:bg-th-hover disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}>
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
            </svg>
          </button>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">
            ×
          </button>
        </div>
      </div>

      <div className="px-6 py-4 flex items-center gap-3 border-b border-th-border shrink-0 bg-th-bg">
        <SimpleSelect value={base} onChange={setBase} options={branchOptions} className="w-56" />
        <button
          title="Swap branches"
          onClick={() => {
            setBase(compare);
            setCompare(base);
          }}
          className="shrink-0 h-8 w-8 grid place-items-center rounded-md border border-th-border-input text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg hover:border-th-accent-border transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
        <SimpleSelect value={compare} onChange={setCompare} options={branchOptions} className="w-56" />
        {compare === currentBranch && (
          <span className="text-[11.5px] font-mono text-th-text-4 bg-th-surface border border-th-border rounded-md px-2 py-1">includes uncommitted changes</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && !summary && <p className="text-[12.5px] text-th-text-4 font-mono">Comparing…</p>}
        {error && <p className="text-[12.5px] text-rose-400 font-mono">{error}</p>}
        {summary && (
          <div className="flex flex-col gap-4 max-w-3xl">
            <div className="flex items-center gap-4 text-[13px] font-mono">
              <span className="text-th-text-1 font-semibold">{totalChanged} request{totalChanged === 1 ? "" : "s"} changed</span>
              <span className="text-emerald-400">+{summary.added} added</span>
              <span className="text-amber-400">~{summary.modified} modified</span>
              <span className="text-rose-400">-{summary.removed} deleted</span>
            </div>

            {summary.breaking.length > 0 && (
              <div className="flex items-center gap-2 bg-rose-400/10 border border-rose-400/25 rounded-md px-3.5 py-2.5 text-[12.5px] text-rose-200">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-rose-400">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>
                  <span className="font-semibold text-rose-300">{summary.breaking.length} potentially breaking change{summary.breaking.length === 1 ? "" : "s"}</span> — expand a
                  flagged request below for details.
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 flex-wrap">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => handleFilterChange(f.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-mono transition-colors ring-1 ${
                    filter === f.key ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
                  }`}
                >
                  {f.label}
                  {f.key !== "all" && categoryCounts[f.key] > 0 && (
                    <span className="text-[9.5px] px-1 rounded-full bg-white/10">{categoryCounts[f.key]}</span>
                  )}
                </button>
              ))}
            </div>

            {totalChanged === 0 && <p className="text-[12.5px] text-th-text-4 font-mono">No API changes between these branches.</p>}
            {totalChanged > 0 && visibleEntries.length === 0 && <p className="text-[12.5px] text-th-text-4 font-mono">No changes match this filter.</p>}

            <div className="flex flex-col gap-4">
              {groupedByFolder.map(([folder, entries]) => {
                const collapsed = collapsedFolders.has(folder);
                return (
                  <div key={folder}>
                    <button onClick={() => toggleFolder(folder)} className="w-full flex items-center gap-2 py-1 text-left">
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 10 10"
                        className={`shrink-0 text-th-text-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                      >
                        <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="text-[11px] font-mono font-semibold text-th-text-3 uppercase tracking-wide">{folder}</span>
                      <span className="text-[11px] font-mono text-th-text-4">
                        {entries.length} change{entries.length === 1 ? "" : "s"}
                      </span>
                      <span className="flex-1 border-t border-th-border ml-2" />
                    </button>
                    {!collapsed && (
                      <div className="flex flex-col gap-2 mt-2">
                        {entries.map((e) => (
                          <EntryCard key={e.path} entry={e} filter={filter} expanded={expanded.has(e.path)} onToggle={() => toggleCard(e.path)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
