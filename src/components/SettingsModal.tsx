import React, { useState } from "react";
import { useWorkspace } from "../store";
import { useTheme } from "../lib/theme";
import { useLayout } from "../lib/layout";
import { pickSavePath, writeFileAtPath } from "../lib/tauri";
import { generateDocsHtml } from "../lib/docsGen";
import AboutModal from "./AboutModal";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const {
    workspace,
    importCollection,
    exportCollection,
    workspaceDir,
    openWorkspaceFolder,
    createWorkspace,
    workspaceOpenError,
    dismissWorkspaceOpenError,
    responseCacheEnabled,
    setResponseCacheEnabled,
    mockServerPort,
    setMockServerPort,
    mockServerRunningPort,
    mockServerError,
    toggleMockServer,
  } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const { responseLayout, setResponseLayout } = useLayout();
  const [status, setStatus] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  const handleGenerateDocs = async () => {
    try {
      const name = (workspace.name?.trim() || "docs").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const path = await pickSavePath(`${name}.html`, "HTML", ["html"]);
      if (!path) return;
      await writeFileAtPath(path, generateDocsHtml(workspace));
      setStatus("Docs generated.");
    } catch (e: any) {
      setStatus(`Docs generation failed: ${e.message || e}`);
    }
  };

  const handleImport = async () => {
    try {
      await importCollection();
      setStatus("Collection imported.");
    } catch (e: any) {
      setStatus(`Import failed: ${e.message || e}`);
    }
  };

  const handleExport = async () => {
    try {
      const result = await exportCollection();
      if (!result) return;
      if (result.skippedGrpcCount > 0) {
        setStatus(
          `Collection exported. ${result.skippedGrpcCount} gRPC request${result.skippedGrpcCount === 1 ? "" : "s"} skipped — Postman does not support gRPC in collection exports.`
        );
      } else {
        setStatus("Collection exported.");
      }
    } catch (e: any) {
      setStatus(`Export failed: ${e.message || e}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-semibold text-th-text-1">Settings</h2>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="flex-1 overflow-auto px-5 pb-5 flex flex-col gap-6">
          <section>
            <h3 className="text-[12px] font-mono text-th-text-3 uppercase tracking-wide mb-2">Appearance</h3>
            <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5">
              <span className="text-[13px] text-th-text-1">Theme</span>
              <button
                onClick={toggleTheme}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
              >
                {theme === "dark" ? "Dark" : "Light"}
              </button>
            </div>
            <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5 mt-2">
              <span className="text-[13px] text-th-text-1">Response panel</span>
              <div className="flex items-center gap-1 bg-th-surface border border-th-border-input rounded-md p-0.5">
                <button
                  onClick={() => setResponseLayout("side")}
                  className={`px-2.5 py-1 rounded text-[12px] font-mono transition-colors ${
                    responseLayout === "side" ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1"
                  }`}
                >
                  Side
                </button>
                <button
                  onClick={() => setResponseLayout("bottom")}
                  className={`px-2.5 py-1 rounded text-[12px] font-mono transition-colors ${
                    responseLayout === "bottom" ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1"
                  }`}
                >
                  Bottom
                </button>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-[12px] font-mono text-th-text-3 uppercase tracking-wide mb-2">Workspace Folder</h3>
            <p className="text-[12px] text-th-text-3 mb-3">
              Requests, folders, and environments are stored as plain-text <span className="font-mono">.relay</span> files in this folder, so it can live in a git repo for diffs and team collaboration.
            </p>
            <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5 gap-3">
              <span className="text-[12px] font-mono text-th-text-2 truncate">{workspaceDir || "Not set — changes are not saved to disk"}</span>
              <div className="shrink-0 flex items-center gap-2">
                <button
                  onClick={() => openWorkspaceFolder()}
                  className="px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
                >
                  Open Folder
                </button>
                <button
                  onClick={() => createWorkspace()}
                  className="px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
                >
                  New Workspace
                </button>
              </div>
            </div>
            {workspaceOpenError && (
              <div className="flex items-center justify-between gap-3 mt-2 text-[12px] text-rose-500">
                <span>{workspaceOpenError}</span>
                <button onClick={dismissWorkspaceOpenError} className="shrink-0 hover:text-rose-600">×</button>
              </div>
            )}
            <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5 mt-2">
              <div>
                <span className="text-[13px] text-th-text-1 block">Save response history</span>
                <span className="text-[11px] text-th-text-3">Cached locally per workspace — never written to the .relay files.</span>
              </div>
              <button
                onClick={() => setResponseCacheEnabled(!responseCacheEnabled)}
                className={`shrink-0 px-3 py-1.5 rounded-md text-[12.5px] font-mono border transition-colors ${
                  responseCacheEnabled
                    ? "border-th-accent-border text-th-accent-text bg-th-accent-bg"
                    : "border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
                }`}
              >
                {responseCacheEnabled ? "On" : "Off"}
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-[12px] font-mono text-th-text-3 uppercase tracking-wide mb-2">Collection Data</h3>
            <p className="text-[12px] text-th-text-3 mb-3">Import a Postman collection (v2.1), OpenAPI 3.x spec (JSON/YAML), or a Relay workspace file, or export your current collection.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Import Collection
              </button>
              <button
                onClick={handleExport}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Export Collection
              </button>
            </div>
            <button
              onClick={handleGenerateDocs}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text mt-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Generate Docs (HTML)
            </button>
            {status && <p className="text-[12px] text-th-text-2 mt-2 font-mono">{status}</p>}
          </section>

          <section>
            <h3 className="text-[12px] font-mono text-th-text-3 uppercase tracking-wide mb-2">Mock Server</h3>
            <p className="text-[12px] text-th-text-3 mb-3">
              Runs a local stand-in server that replies from this workspace's cached example responses — not your real backend. Point a frontend at it to develop against an API that isn't running yet.
            </p>
            <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-2 w-2 rounded-full shrink-0 ${mockServerRunningPort ? "bg-emerald-400" : "bg-th-text-4"}`} />
                <span className="text-[12px] font-mono text-th-text-2 truncate">
                  {mockServerRunningPort ? `Running at http://localhost:${mockServerRunningPort}` : "Not running"}
                </span>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {!mockServerRunningPort && (
                  <input
                    type="number"
                    value={mockServerPort}
                    onChange={(e) => setMockServerPort(Number(e.target.value) || 4010)}
                    className="w-20 bg-th-surface border border-th-border-input rounded-md px-2 py-1.5 text-[12.5px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
                  />
                )}
                <button
                  onClick={toggleMockServer}
                  className={`px-3 py-1.5 rounded-md text-[12.5px] font-mono border transition-colors ${
                    mockServerRunningPort
                      ? "border-rose-400/40 text-rose-400 hover:bg-rose-400/10"
                      : "border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
                  }`}
                >
                  {mockServerRunningPort ? "Stop" : "Start"}
                </button>
              </div>
            </div>
            {mockServerError && <p className="text-[12px] text-rose-400 mt-2 font-mono">{mockServerError}</p>}
          </section>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-th-border">
          <button
            onClick={() => setShowAbout(true)}
            className="text-[12.5px] text-th-text-3 hover:text-th-text-1"
          >
            About Relay
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover"
          >
            Done
          </button>
        </div>
      </div>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
