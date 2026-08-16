import React, { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../store";
import { gitStatus, gitCommit, gitInit, GitStatusInfo } from "../lib/tauri";

const STATUS_COLOR: Record<string, string> = {
  M: "text-amber-400",
  A: "text-emerald-400",
  D: "text-rose-400",
  R: "text-sky-400",
  U: "text-th-text-3",
};

function CommitModal({ info, onClose, onCommitted }: { info: GitStatusInfo; onClose: () => void; onCommitted: () => void }) {
  const { workspaceDir } = useWorkspace();
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    if (!workspaceDir || !message.trim() || committing) return;
    setCommitting(true);
    setError(null);
    try {
      await gitCommit(workspaceDir, message.trim());
      setMessage("");
      onCommitted();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[440px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-semibold text-th-text-1">Source Control</h2>
            <span className="text-[11px] font-mono text-th-text-3 bg-th-bg border border-th-border rounded px-1.5 py-0.5">{info.branch}</span>
          </div>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="flex-1 overflow-auto px-5 pb-3">
          <label className="text-[11px] font-mono text-th-text-3 mb-1.5 block">Changes ({info.files.length})</label>
          {info.files.length === 0 ? (
            <p className="text-[12px] text-th-text-4 font-mono">No changes</p>
          ) : (
            <div className="flex flex-col gap-1">
              {info.files.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-[12.5px] font-mono">
                  <span className={`shrink-0 w-4 text-center ${STATUS_COLOR[f.status] || "text-th-text-3"}`}>{f.status}</span>
                  <span className="truncate text-th-text-2">{f.path}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex flex-col gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleCommit(); }}
            placeholder={`Message (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to commit)`}
            rows={2}
            className="w-full resize-none bg-th-bg border border-th-border-input rounded-md px-3 py-2 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
          />
          {error && <p className="text-[12px] text-rose-400 font-mono">{error}</p>}
          <button
            onClick={handleCommit}
            disabled={!message.trim() || info.files.length === 0 || committing}
            className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {committing ? "Committing…" : `Commit${info.files.length ? ` (${info.files.length})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GitPanel() {
  const { workspaceDir } = useWorkspace();
  const [info, setInfo] = useState<GitStatusInfo | null>(null);
  const [notARepo, setNotARepo] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [initializing, setInitializing] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceDir) {
      setInfo(null);
      setNotARepo(false);
      return;
    }
    try {
      const result = await gitStatus(workspaceDir);
      setInfo(result);
      setNotARepo(result === null);
    } catch {
      setInfo(null);
      setNotARepo(false);
    }
  }, [workspaceDir]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const handleInit = async () => {
    if (!workspaceDir || initializing) return;
    setInitializing(true);
    try {
      await gitInit(workspaceDir);
      await refresh();
    } finally {
      setInitializing(false);
    }
  };

  if (notARepo) {
    return (
      <div className="shrink-0 border-t border-th-border px-3 py-1.5 flex items-center justify-between text-[11.5px] font-mono text-th-text-2">
        <span className="flex items-center gap-1.5 truncate">
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-th-text-4" />
          <span className="truncate text-th-text-3">Not a git repo</span>
        </span>
        <button
          onClick={handleInit}
          disabled={initializing}
          className="shrink-0 text-th-accent-text hover:underline disabled:opacity-40"
        >
          {initializing ? "Initializing…" : "Initialize"}
        </button>
      </div>
    );
  }

  if (!info) return null;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="shrink-0 border-t border-th-border px-3 py-1.5 flex items-center justify-between text-[11.5px] font-mono text-th-text-2 hover:bg-th-hover"
      >
        <span className="flex items-center gap-1.5 truncate">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-th-text-3">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 01-9 9" />
          </svg>
          <span className="truncate">{info.branch}</span>
        </span>
        {info.files.length > 0 && (
          <span className="shrink-0 bg-th-accent-bg text-th-accent-text rounded-full px-1.5 min-w-[18px] text-center">{info.files.length}</span>
        )}
      </button>
      {showModal && (
        <CommitModal info={info} onClose={() => setShowModal(false)} onCommitted={refresh} />
      )}
    </>
  );
}
