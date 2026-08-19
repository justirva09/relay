import React, { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../store";
import { gitBranchDiff, gitAdd, gitCommitStaged, writeFileAtPath, BranchDiffEntry } from "../lib/tauri";
import { buildBranchDiffSummary, BranchRequestDiff, DiffCategory, DiffLine } from "../lib/apiDiff";
import { mergeSelectedRequestFields, suggestCommitMessage, StagedEntrySummary } from "../lib/apiStage";

const CATEGORY_ORDER: DiffCategory[] = ["method", "url", "auth", "query", "header", "body"];
const CATEGORY_LABEL: Record<DiffCategory, string> = { method: "Method", url: "URL", auth: "Auth", query: "Query", header: "Headers", body: "Body" };

const STATUS_BADGE: Record<BranchRequestDiff["status"], string> = {
  added: "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30",
  removed: "text-rose-400 bg-rose-400/10 ring-rose-400/30",
  modified: "text-amber-400 bg-amber-400/10 ring-amber-400/30",
};

function TriStateCheckbox({ state, onChange }: { state: "all" | "none" | "partial"; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "partial";
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="accent-th-accent shrink-0"
    />
  );
}

function categoriesOf(entry: BranchRequestDiff): DiffCategory[] {
  return CATEGORY_ORDER.filter((c) => entry.diffLines.some((l) => l.category === c));
}

export default function StageCommitModal({ branch, onClose, onCommitted }: { branch: string; onClose: () => void; onCommitted: () => void }) {
  const { workspaceDir, pauseAutosave, resumeAutosave } = useWorkspace();
  const [rawEntries, setRawEntries] = useState<BranchDiffEntry[] | null>(null);
  const [entries, setEntries] = useState<BranchRequestDiff[]>([]);
  const [fieldSelections, setFieldSelections] = useState<Map<string, Set<DiffCategory>>>(new Map());
  const [wholeSelections, setWholeSelections] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceDir) return;
    gitBranchDiff(workspaceDir, "HEAD", null).then((raw) => {
      setRawEntries(raw);
      const summary = buildBranchDiffSummary(raw);
      const all = [...summary.breaking, ...summary.safe];
      setEntries(all);
      // Default: everything selected — matches the old "commit everything" behavior unless you opt to hold something back.
      const fields = new Map<string, Set<DiffCategory>>();
      const whole = new Set<string>();
      for (const e of all) {
        if (e.status === "modified" && e.kind !== "grpc") fields.set(e.path, new Set(categoriesOf(e)));
        else whole.add(e.path);
      }
      setFieldSelections(fields);
      setWholeSelections(whole);
    });
  }, [workspaceDir]);

  const toggleWhole = (path: string) => {
    setWholeSelections((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleParent = (entry: BranchRequestDiff) => {
    const cats = categoriesOf(entry);
    setFieldSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(entry.path) ?? new Set<DiffCategory>();
      next.set(entry.path, current.size === cats.length ? new Set() : new Set(cats));
      return next;
    });
  };

  const toggleCategory = (path: string, category: DiffCategory) => {
    setFieldSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(path) ?? []);
      if (current.has(category)) current.delete(category);
      else current.add(category);
      next.set(path, current);
      return next;
    });
  };

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const totalSelected = useMemo(() => {
    let n = wholeSelections.size;
    for (const s of fieldSelections.values()) if (s.size > 0) n++;
    return n;
  }, [wholeSelections, fieldSelections]);

  const handleSuggest = () => {
    const summaries: StagedEntrySummary[] = [];
    for (const e of entries) {
      if (e.status === "modified") {
        const cats = fieldSelections.get(e.path);
        if (cats && cats.size > 0) summaries.push({ status: "modified", name: e.name, categories: Array.from(cats) });
      } else if (wholeSelections.has(e.path)) {
        summaries.push({ status: e.status, name: e.name, categories: [] });
      }
    }
    setMessage(suggestCommitMessage(summaries));
  };

  const handleCommit = async () => {
    if (!workspaceDir || !rawEntries || !message.trim() || committing) return;
    setCommitting(true);
    setError(null);
    // The merge→write→add→commit→restore sequence below writes specific
    // files directly to disk, bypassing React state entirely — if the
    // app's own debounced autosave (store.tsx) fires mid-sequence, its
    // full-tree rewrite from the in-memory draft silently clobbers a
    // carefully-merged partial-field file before `git add` reads it,
    // dragging unselected field changes into the commit.
    pauseAutosave();
    try {
      const pathsToAdd: string[] = [];
      const restores: { path: string; content: string }[] = [];

      for (const raw of rawEntries) {
        const entry = entries.find((e) => e.path === raw.path);
        // gRPC entries are always whole-file (see the isWhole comment above)
        // regardless of add/modify/remove — check wholeSelections for them
        // too, or a checked "modified" gRPC entry would silently never get
        // staged at all.
        if (raw.status === "added" || raw.status === "removed" || entry?.kind === "grpc") {
          if (!wholeSelections.has(raw.path)) continue;
          pathsToAdd.push(raw.path);
          continue;
        }
        const selected = fieldSelections.get(raw.path);
        if (!selected || selected.size === 0) continue;

        const allCats = entry ? categoriesOf(entry) : [];
        const isFullySelected = allCats.length > 0 && allCats.every((c) => selected.has(c));

        if (isFullySelected || !raw.before || !raw.after) {
          pathsToAdd.push(raw.path);
          continue;
        }

        const beforeFull = JSON.parse(raw.before);
        const afterFull = JSON.parse(raw.after);
        const merged = mergeSelectedRequestFields(beforeFull, afterFull, selected);
        const absPath = `${workspaceDir}/${raw.path}`;
        await writeFileAtPath(absPath, JSON.stringify(merged, null, 2));
        pathsToAdd.push(raw.path);
        restores.push({ path: absPath, content: raw.after });
      }

      if (pathsToAdd.length === 0) {
        setError("Nothing selected to commit.");
        setCommitting(false);
        return;
      }

      await gitAdd(workspaceDir, pathsToAdd);
      await gitCommitStaged(workspaceDir, message.trim());

      // Restore the deselected-field edits in the working tree — they were
      // only ever swapped out on disk to build what got staged/committed.
      for (const r of restores) await writeFileAtPath(r.path, r.content);

      onCommitted();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      resumeAutosave();
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[680px] max-h-[82vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-semibold text-th-text-1">Source Control</h2>
            <span className="text-[11px] font-mono text-th-text-3 bg-th-bg border border-th-border rounded px-1.5 py-0.5">{branch}</span>
          </div>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="flex-1 overflow-auto px-5 pb-3 flex flex-col gap-2.5">
          <label className="text-[12px] font-mono text-th-text-2 mb-1 block shrink-0">Changes ({entries.length}) — {totalSelected} selected to commit</label>
          {entries.length === 0 ? (
            <p className="text-[12px] text-th-text-4 font-mono">No changes</p>
          ) : (
            entries.map((entry) => {
              const cats = categoriesOf(entry);
              // gRPC entries have no field-level diff (categoriesOf is always
              // empty for them) — always whole-file, regardless of status,
              // or the tri-state checkbox above would be stuck permanently
              // unselectable (0 selected === 0 available "categories").
              const isWhole = entry.status !== "modified" || entry.kind === "grpc";
              const selectedCats = fieldSelections.get(entry.path) ?? new Set<DiffCategory>();
              const parentState: "all" | "none" | "partial" = isWhole
                ? wholeSelections.has(entry.path)
                  ? "all"
                  : "none"
                : selectedCats.size === 0
                ? "none"
                : selectedCats.size === cats.length
                ? "all"
                : "partial";

              return (
                <div key={entry.path} className="border border-th-border rounded-md overflow-hidden bg-th-bg shrink-0">
                  <div
                    className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-th-hover cursor-pointer"
                    onClick={() => !isWhole && toggleExpanded(entry.path)}
                  >
                    <TriStateCheckbox state={parentState} onChange={() => (isWhole ? toggleWhole(entry.path) : toggleParent(entry))} />
                    <span className={`px-2 py-1 rounded text-[10.5px] font-mono font-bold ring-1 uppercase shrink-0 ${STATUS_BADGE[entry.status]}`}>
                      {entry.status === "modified" ? "mod" : entry.status}
                    </span>
                    <span className="font-mono text-th-text-2 text-[12px] font-semibold shrink-0 w-11">{entry.method}</span>
                    <span className="text-[13.5px] text-th-text-1 truncate">{entry.name}</span>
                    {!isWhole && cats.length > 0 && (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 10 10"
                        className={`ml-auto shrink-0 text-th-text-3 transition-transform ${expanded.has(entry.path) ? "rotate-180" : ""}`}
                      >
                        <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  {!isWhole && expanded.has(entry.path) && (
                    <div className="border-t border-th-border px-3 py-2.5 flex flex-col gap-2 bg-th-surface">
                      {cats.map((cat) => (
                        <label key={cat} className="flex items-center gap-2.5 text-[12.5px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedCats.has(cat)}
                            onChange={() => toggleCategory(entry.path, cat)}
                            className="accent-th-accent shrink-0"
                          />
                          <span className="font-mono text-th-text-2 font-semibold w-16 shrink-0">{CATEGORY_LABEL[cat]}</span>
                          <span className="text-th-text-1 truncate">
                            {entry.diffLines
                              .filter((l) => l.category === cat)
                              .map((l: DiffLine) => l.text)
                              .join(" · ")}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 pb-5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-th-text-3">Message</span>
            <button onClick={handleSuggest} className="text-[11px] font-mono text-th-accent-text hover:underline">
              Suggest
            </button>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleCommit();
            }}
            placeholder={`Message (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to commit)`}
            rows={2}
            className="w-full resize-none bg-th-bg border border-th-border-input rounded-md px-3 py-2 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
          />
          {error && <p className="text-[12px] text-rose-400 font-mono">{error}</p>}
          <button
            onClick={handleCommit}
            disabled={!message.trim() || totalSelected === 0 || committing}
            className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {committing ? "Committing…" : `Commit${totalSelected ? ` (${totalSelected})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
