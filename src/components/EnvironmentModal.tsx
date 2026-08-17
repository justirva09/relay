import React, { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../store";
import { KVRow, newRow } from "../types";
import { useTheme } from "../lib/theme";
import { useLayout } from "../lib/layout";
import SettingsModal from "./SettingsModal";

function EnvDropdown() {
  const { workspace, setActiveEnvironment } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeEnv = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 bg-th-surface border border-th-border rounded-md px-2.5 py-1 text-[12px] font-mono text-th-text-1 hover:border-th-text-4 min-w-[160px]"
      >
        <span className={`flex-1 text-left truncate ${activeEnv ? "text-emerald-400" : "text-th-text-3"}`}>
          {activeEnv ? activeEnv.name : "No Environment"}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-th-text-3 shrink-0">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[180px]">
          <button
            onClick={() => { setActiveEnvironment(null); setOpen(false); }}
            className={`w-full px-3 py-1.5 text-left text-[12px] font-mono hover:bg-th-hover flex items-center gap-2 ${!activeEnv ? "text-th-text-1" : "text-th-text-3"}`}
          >
            {!activeEnv && <span className="text-[10px]">✓</span>}
            <span className={activeEnv ? "pl-[18px]" : ""}>No Environment</span>
          </button>
          {workspace.environments.length > 0 && <div className="my-1 border-t border-th-border" />}
          {workspace.environments.map((env) => {
            const selected = env.id === workspace.activeEnvironmentId;
            return (
              <button
                key={env.id}
                onClick={() => { setActiveEnvironment(env.id); setOpen(false); }}
                className={`w-full px-3 py-1.5 text-left text-[12px] font-mono hover:bg-th-hover flex items-center gap-2 ${selected ? "text-emerald-400" : "text-th-text-1"}`}
              >
                {selected && <span className="text-[10px]">✓</span>}
                <span className={selected ? "" : "pl-[18px]"}>{env.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EnvironmentBar({ onShowOverview }: { onShowOverview: () => void }) {
  const [showModal, setShowModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { responseLayout, setResponseLayout } = useLayout();
  const { mockServerRunningPort, toggleMockServer } = useWorkspace();

  const handleCopyMockUrl = () => {
    if (!mockServerRunningPort) return;
    navigator.clipboard.writeText(`http://localhost:${mockServerRunningPort}`).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1200);
    });
  };

  return (
    <>
      <div className="h-[49px] flex items-center justify-end gap-2 px-3 border-b border-th-border bg-th-bg shrink-0">
        <button
          title="Workspace overview"
          onClick={onShowOverview}
          className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg mr-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <div className="w-px h-5 bg-th-border mx-0.5" />
        <button
          title={mockServerRunningPort ? `Stop mock server (localhost:${mockServerRunningPort})` : "Start mock server"}
          onClick={toggleMockServer}
          className={`h-6 shrink-0 flex items-center gap-1 rounded-full pl-2 pr-2.5 text-[11px] font-mono leading-none transition-colors ${
            mockServerRunningPort
              ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
              : "bg-th-accent text-white hover:bg-th-accent-hover"
          }`}
        >
          {mockServerRunningPort ? (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="shrink-0"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
          ) : (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="shrink-0"><path d="M7 5l12 7-12 7V5z" /></svg>
          )}
          {mockServerRunningPort ? "Stop" : "Start"}
        </button>
        <span
          className={`h-6 shrink-0 flex items-center rounded-full px-2.5 text-[11px] font-mono leading-none ${
            mockServerRunningPort ? "bg-emerald-400/15 text-emerald-400" : "bg-th-hover text-th-text-3"
          }`}
        >
          {mockServerRunningPort ? `Running :${mockServerRunningPort}` : "Stopped"}
        </span>
        {mockServerRunningPort && (
          <button
            title="Copy mock server URL"
            onClick={handleCopyMockUrl}
            className="h-6 w-6 shrink-0 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
          >
            {urlCopied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        )}
        <div className="w-px h-5 bg-th-border mx-0.5" />
        <EnvDropdown />
        <button
          onClick={() => setShowModal(true)}
          className="px-2.5 py-1 rounded-md text-[12px] font-mono text-th-text-2 border border-th-border hover:text-th-text-1 hover:border-th-text-4"
        >
          Envs
        </button>
        <div className="w-px h-5 bg-th-border mx-0.5" />
        <button
          title={responseLayout === "side" ? "Switch response panel to bottom" : "Switch response panel to side"}
          onClick={() => setResponseLayout(responseLayout === "side" ? "bottom" : "side")}
          className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
        >
          {responseLayout === "side" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="1.5" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="1.5" />
              <line x1="3" y1="13" x2="21" y2="13" />
            </svg>
          )}
        </button>
        <div className="w-px h-5 bg-th-border mx-0.5" />
        <button
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={toggleTheme}
          className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
        >
          {theme === "dark" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
        <button
          title="Settings"
          onClick={() => setShowSettings(true)}
          className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>
      {showModal && <EnvironmentModal onClose={() => setShowModal(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}

function EnvironmentModal({ onClose }: { onClose: () => void }) {
  const { workspace, addEnvironment, deleteEnvironment, renameEnvironment, setActiveEnvironment, setEnvironmentVariables, setVariables } = useWorkspace();
  const [tab, setTab] = useState<string | "globals">(workspace.activeEnvironmentId || "globals");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedEnv = tab !== "globals" ? workspace.environments.find((e) => e.id === tab) : null;

  const handleAddEnv = () => {
    const id = addEnvironment();
    if (typeof id === "string") setTab(id);
  };

  const handleDeleteEnv = (id: string) => {
    deleteEnvironment(id);
    setConfirmDeleteId(null);
    setTab("globals");
  };

  const handleVarChange = (rows: KVRow[]) => {
    if (tab === "globals") {
      setVariables(rows);
    } else {
      setEnvironmentVariables(tab, rows);
    }
  };

  const handleAddRow = () => {
    if (tab === "globals") {
      setVariables([...workspace.variables, newRow()]);
    } else if (selectedEnv) {
      setEnvironmentVariables(tab, [...selectedEnv.variables, newRow()]);
    }
  };

  const handleRemoveRow = (rowId: string) => {
    if (tab === "globals") {
      const filtered = workspace.variables.filter((r) => r.id !== rowId);
      setVariables(filtered.length ? filtered : [newRow()]);
    } else if (selectedEnv) {
      const filtered = selectedEnv.variables.filter((r) => r.id !== rowId);
      setEnvironmentVariables(tab, filtered.length ? filtered : [newRow()]);
    }
  };

  const handleRowChange = (rowId: string, field: "key" | "value" | "secret", val: string | boolean) => {
    const rows = tab === "globals" ? workspace.variables : selectedEnv?.variables || [];
    const updated = rows.map((r) => (r.id === rowId ? { ...r, [field]: val } : r));
    const last = updated[updated.length - 1];
    if (last && (last.key.trim() || last.value.trim())) updated.push(newRow());
    handleVarChange(updated);
  };

  const currentRows = tab === "globals" ? workspace.variables : selectedEnv?.variables || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-semibold text-th-text-1">Environments</h2>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="px-5 pb-3 flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setTab("globals")}
            className={`px-3 py-1.5 rounded-md text-[12px] font-mono border transition-colors ${
              tab === "globals"
                ? "border-th-accent-border text-th-accent-text bg-th-accent-bg"
                : "border-th-border text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
            }`}
          >
            Globals
          </button>
          {workspace.environments.map((env) => (
            <button
              key={env.id}
              onClick={() => setTab(env.id)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-mono border transition-colors ${
                tab === env.id
                  ? "border-th-accent-border text-th-accent-text bg-th-accent-bg"
                  : "border-th-border text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
              }`}
            >
              {env.name}
            </button>
          ))}
          <button
            onClick={handleAddEnv}
            className="px-3 py-1.5 rounded-md text-[12px] font-mono border border-dashed border-th-border text-th-text-3 hover:text-emerald-400 hover:border-emerald-400/50"
          >
            + New
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 pb-5">
          {tab !== "globals" && selectedEnv && (
            <div className="mb-4">
              <label className="text-[11px] font-mono text-th-text-3 mb-1.5 block">Name</label>
              <input
                value={selectedEnv.name}
                onChange={(e) => renameEnvironment(selectedEnv.id, e.target.value)}
                className="w-full bg-th-bg border border-th-border-input rounded-md px-3 py-2 text-[13px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
              />
            </div>
          )}

          {tab === "globals" && (
            <div className="mb-4">
              <p className="text-[11px] font-mono text-th-text-3">Global variables available in all environments. Use <span className="text-th-text-2">{"{{var}}"}</span> in URL, headers, or body.</p>
            </div>
          )}
          {tab !== "globals" && (
            <div className="mb-4">
              <p className="text-[11px] font-mono text-th-text-3">Mark a variable secret to keep its value out of the committed <span className="text-th-text-2">.relay</span> file — it's written to a gitignored file instead.</p>
            </div>
          )}

          <label className="text-[11px] font-mono text-th-text-3 mb-1.5 block">Variables</label>
          <div className="flex flex-col gap-1.5">
            {currentRows.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <input
                  value={r.key}
                  onChange={(e) => handleRowChange(r.id, "key", e.target.value)}
                  placeholder="key"
                  className="flex-1 min-w-0 bg-th-bg border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
                />
                <input
                  value={r.value}
                  onChange={(e) => handleRowChange(r.id, "value", e.target.value)}
                  placeholder="value"
                  type={tab !== "globals" && r.secret ? "password" : "text"}
                  className="flex-1 min-w-0 bg-th-bg border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
                />
                {tab !== "globals" && (
                  <button
                    onClick={() => handleRowChange(r.id, "secret", !r.secret)}
                    title={r.secret ? "Secret — stored outside git" : "Mark as secret"}
                    className={`shrink-0 h-7 w-7 grid place-items-center rounded ${r.secret ? "text-amber-400 hover:bg-amber-400/10" : "text-th-text-4 hover:text-th-text-2 hover:bg-th-hover"}`}
                  >
                    {r.secret ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 019.9-1" />
                      </svg>
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleRemoveRow(r.id)}
                  className="shrink-0 h-7 w-7 grid place-items-center rounded text-th-text-4 hover:text-rose-400 hover:bg-rose-400/10"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={handleAddRow}
            className="mt-2 px-3 py-1.5 rounded-md text-[12px] font-mono border border-dashed border-th-border text-th-text-3 hover:text-th-accent-text hover:border-th-accent-border"
          >
            + Add row
          </button>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-th-border">
          <div>
            {tab !== "globals" && selectedEnv && (
              confirmDeleteId === selectedEnv.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-rose-400">Delete "{selectedEnv.name}"?</span>
                  <button
                    onClick={() => handleDeleteEnv(selectedEnv.id)}
                    className="px-2.5 py-1 rounded text-[12px] bg-rose-500 text-white hover:bg-rose-400"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-2.5 py-1 rounded text-[12px] text-th-text-2 hover:text-th-text-1"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(selectedEnv.id)}
                  className="px-3 py-1.5 rounded text-[12px] text-rose-400 hover:bg-rose-400/10 flex items-center gap-1.5"
                >
                  Delete
                </button>
              )
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
