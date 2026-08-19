import React, { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../store";
import { gitStatus, gitInit, GitStatusInfo } from "../lib/tauri";
import StageCommitModal from "./StageCommitModal";

export default function GitPanel() {
  const { workspaceDir, openCompare } = useWorkspace();
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
      <div className="shrink-0 border-t border-th-border flex items-center text-[11.5px] font-mono text-th-text-2">
        <button
          onClick={() => setShowModal(true)}
          className="flex-1 min-w-0 px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-th-hover"
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
        <button
          title="Compare branches"
          onClick={openCompare}
          className="shrink-0 px-2.5 py-1.5 hover:bg-th-hover hover:text-th-accent-text"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3l4 4-4 4M21 7H9M7 13l-4 4 4 4M3 17h12" />
          </svg>
        </button>
      </div>
      {showModal && (
        <StageCommitModal branch={info.branch} onClose={() => setShowModal(false)} onCommitted={() => { setShowModal(false); refresh(); }} />
      )}
    </>
  );
}
