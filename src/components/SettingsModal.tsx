import React, { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { useWorkspace } from "../store";
import { useLayout } from "../lib/layout";
import { pickSavePath, writeFileAtPath } from "../lib/tauri";
import { generateDocsHtml } from "../lib/docsGen";
import { AppearanceSettings } from "./ThemeModal";
import { ScriptSafetySettings } from "./ScriptSafetyModal";
import { KEYBINDING_DEFS, getEffectiveCombo, setCombo, resetCombo, resetAllCombos, subscribeKeybindings, comboFromEvent, comboToChips, actionForCombo, isCustomized } from "../lib/keybindings";
import { getLicenseState, subscribeLicense, signInWithGitHub, signOut, refreshLicense } from "../lib/license";
import appIcon from "../assets/app-icon.png";
import pkg from "../../package.json";

const WEBSITE_URL = "https://relay-landing-page-iota.vercel.app/";
const AUTHOR_URL = "https://www.linkedin.com/in/justirva/";

type SectionId = "general" | "appearance" | "security" | "keybindings" | "account" | "import-export" | "mock-server" | "about";

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  {
    id: "general",
    label: "General",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      </svg>
    ),
  },
  {
    id: "security",
    label: "Security",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
      </svg>
    ),
  },
  {
    id: "keybindings",
    label: "Keybindings",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <line x1="6" y1="10" x2="6" y2="10" /><line x1="10" y1="10" x2="10" y2="10" /><line x1="14" y1="10" x2="14" y2="10" /><line x1="18" y1="10" x2="18" y2="10" />
        <line x1="6" y1="14" x2="18" y2="14" />
      </svg>
    ),
  },
  {
    id: "account",
    label: "Account",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    ),
  },
  {
    id: "import-export",
    label: "Import & Export",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
  {
    id: "mock-server",
    label: "Mock Server",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    id: "about",
    label: "About",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
];

function SectionHeading({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-[18px] font-semibold text-th-text-1">{title}</h3>
      {desc && <p className="text-[12.5px] text-th-text-3 mt-1">{desc}</p>}
    </div>
  );
}

function GeneralSection() {
  const { workspaceDir, openWorkspaceFolder, createWorkspace, workspaceOpenError, dismissWorkspaceOpenError, responseCacheEnabled, setResponseCacheEnabled } = useWorkspace();
  const { responseLayout, setResponseLayout } = useLayout();

  return (
    <div>
      <SectionHeading title="General" />
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-2">Workspace Folder</p>
          <p className="text-[12px] text-th-text-3 mb-2">
            Requests, folders, and environments are stored as plain-text <span className="font-mono">.relay</span> files in this folder, so it can live in a git repo for diffs and team collaboration.
          </p>
          <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5 gap-3">
            <span className="text-[12px] font-mono text-th-text-2 truncate">{workspaceDir || "Not set — changes are not saved to disk"}</span>
            <div className="shrink-0 flex items-center gap-2">
              <button onClick={() => openWorkspaceFolder()} className="px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4">
                Open Folder
              </button>
              <button onClick={() => createWorkspace()} className="px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4">
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
        </div>

        <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5">
          <div>
            <span className="text-[13px] text-th-text-1 block">Save response history</span>
            <span className="text-[11px] text-th-text-3">Cached locally per workspace — never written to the .relay files.</span>
          </div>
          <button
            onClick={() => setResponseCacheEnabled(!responseCacheEnabled)}
            className={`shrink-0 px-3 py-1.5 rounded-md text-[12.5px] font-mono border transition-colors ${
              responseCacheEnabled ? "border-th-accent-border text-th-accent-text bg-th-accent-bg" : "border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
            }`}
          >
            {responseCacheEnabled ? "On" : "Off"}
          </button>
        </div>

        <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5">
          <span className="text-[13px] text-th-text-1">Response panel</span>
          <div className="flex items-center gap-1 bg-th-surface border border-th-border-input rounded-md p-0.5">
            <button
              onClick={() => setResponseLayout("side")}
              className={`px-2.5 py-1 rounded text-[12px] font-mono transition-colors ${responseLayout === "side" ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1"}`}
            >
              Side
            </button>
            <button
              onClick={() => setResponseLayout("bottom")}
              className={`px-2.5 py-1 rounded text-[12px] font-mono transition-colors ${responseLayout === "bottom" ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1"}`}
            >
              Bottom
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportExportSection() {
  const { workspace, importCollection, exportCollection } = useWorkspace();
  const [status, setStatus] = useState<string | null>(null);

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

  return (
    <div>
      <SectionHeading title="Import & Export" desc="Import a Postman collection (v2.1), OpenAPI 3.x spec (JSON/YAML), or a Relay workspace file, or export your current collection." />
      <div className="flex items-center gap-2">
        <button
          onClick={() => importCollection()}
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
          onClick={exportCollection}
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
    </div>
  );
}

function MockServerSection() {
  const { mockServerPort, setMockServerPort, mockServerRunningPort, mockServerError, toggleMockServer } = useWorkspace();

  return (
    <div>
      <SectionHeading
        title="Mock Server"
        desc="Runs a local stand-in server that replies from this workspace's cached example responses — not your real backend. Point a frontend at it to develop against an API that isn't running yet."
      />
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
              mockServerRunningPort ? "border-rose-400/40 text-rose-400 hover:bg-rose-400/10" : "border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
            }`}
          >
            {mockServerRunningPort ? "Stop" : "Start"}
          </button>
        </div>
      </div>
      {mockServerError && <p className="text-[12px] text-rose-400 mt-2 font-mono">{mockServerError}</p>}
    </div>
  );
}

const PLAN_LABELS: Record<string, string> = { free: "Free", pro: "Pro" };

function AccountSection() {
  const [licenseState, setLicenseState] = useState(getLicenseState());
  useEffect(() => subscribeLicense(() => setLicenseState(getLicenseState())), []);

  const { session, license, loading, error } = licenseState;

  return (
    <div>
      <SectionHeading title="Account" desc="Sign in to unlock Relay Pro features. Everything else keeps working fully offline either way." />
      {!session ? (
        <button
          onClick={() => signInWithGitHub()}
          disabled={loading}
          className="flex items-center gap-2 px-3.5 py-2 rounded-md text-[13px] font-semibold bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-60 transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .3a12 12 0 00-3.8 23.38c.6.12.83-.26.83-.58v-2.02c-3.34.72-4.04-1.6-4.04-1.6-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.6-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .3z" />
          </svg>
          {loading ? "Waiting for browser…" : "Sign in with GitHub"}
        </button>
      ) : (
        <div className="flex flex-col gap-3 max-w-md">
          <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5">
            <div>
              <p className="text-[13px] text-th-text-1 font-medium">{session.email ?? session.userId}</p>
              <p className="text-[11.5px] text-th-text-3 mt-0.5">
                Plan: <span className="font-mono">{PLAN_LABELS[license?.plan ?? "free"] ?? license?.plan ?? "Free"}</span>
                {license?.status && license.status !== "active" && <span className="text-amber-400"> · {license.status}</span>}
              </p>
            </div>
            <button onClick={() => signOut()} className="px-2.5 py-1 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4">
              Sign Out
            </button>
          </div>
          {license && license.features.length > 0 && (
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Unlocked features</p>
              <div className="flex flex-wrap gap-1.5">
                {license.features.map((f) => (
                  <span key={f} className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-400/10 text-emerald-400">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => refreshLicense()}
            disabled={loading}
            className="self-start px-2.5 py-1 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4 disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh License"}
          </button>
        </div>
      )}
      {error && <p className="text-[11.5px] text-rose-400 mt-3">{error}</p>}
    </div>
  );
}

function AboutSection() {
  const [version, setVersion] = useState<string | null>(pkg.version);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div>
      <SectionHeading title="About" />
      <div className="flex flex-col items-center text-center gap-1 py-4">
        <img src={appIcon} alt="Relay" className="w-16 h-16 rounded-2xl shadow-lg mb-2" />
        <span className="text-[15px] font-semibold text-th-text-1">Relay</span>
        <span className="text-[12px] font-mono text-th-text-3">Version {version || "—"}</span>
        <p className="text-[12.5px] text-th-text-2 mt-3 max-w-[320px]">
          Relay helps you build, test, and version-control HTTP and gRPC requests — faster.
        </p>
        <button onClick={() => open(WEBSITE_URL).catch(() => window.open(WEBSITE_URL, "_blank"))} className="text-[12.5px] text-th-accent-text hover:underline mt-3">
          Website
        </button>
        <span className="text-[11px] text-th-text-4 mt-4">Copyright © 2026 Relay. All rights reserved.</span>
        <button onClick={() => open(AUTHOR_URL).catch(() => window.open(AUTHOR_URL, "_blank"))} className="text-[11px] text-th-text-4 hover:text-th-accent-text hover:underline mt-1">
          Created by Justirva
        </button>
      </div>
    </div>
  );
}

function KeyChip({ text }: { text: string }) {
  return (
    <span className="min-w-[22px] px-1.5 py-0.5 rounded border border-th-border-input bg-th-bg text-[11px] font-mono text-th-text-2 text-center">
      {text}
    </span>
  );
}

function KeybindingRow({ def, recordingId, onStartRecord }: {
  def: (typeof KEYBINDING_DEFS)[number];
  recordingId: string | null;
  onStartRecord: (id: string | null) => void;
}) {
  const [, forceRerender] = useState(0);
  useEffect(() => subscribeKeybindings(() => forceRerender((n) => n + 1)), []);

  const combo = getEffectiveCombo(def.id);
  const recording = recordingId === def.id;
  const customized = isCustomized(def.id);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        onStartRecord(null);
        return;
      }
      const next = comboFromEvent(e);
      if (!next || ["mod", "shift", "alt"].includes(next)) return;
      setCombo(def.id, next);
      onStartRecord(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, def.id, onStartRecord]);

  const conflictId = combo ? actionForCombo(combo) : null;
  const conflictLabel = conflictId && conflictId !== def.id ? KEYBINDING_DEFS.find((d) => d.id === conflictId)?.label : null;

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-th-hover group">
      <span className="text-[13px] text-th-text-2">{def.label}</span>
      <div className="flex items-center gap-2">
        {conflictLabel && (
          <span className="text-[10.5px] text-amber-400" title={`Also used by "${conflictLabel}"`}>
            conflicts
          </span>
        )}
        <button
          onClick={() => onStartRecord(recording ? null : def.id)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-mono min-w-[90px] justify-center transition-colors ${
            recording ? "border-th-accent-border bg-th-accent-bg text-th-accent-text" : "border-th-border-input hover:border-th-text-4"
          }`}
        >
          {recording ? (
            <span className="text-th-text-3">Press keys…</span>
          ) : combo ? (
            comboToChips(combo).map((c, i) => <KeyChip key={i} text={c} />)
          ) : (
            <span className="text-th-text-4">Unassigned</span>
          )}
        </button>
        {customized && (
          <button onClick={() => resetCombo(def.id)} title="Reset to default" className="text-th-text-4 hover:text-th-text-1 text-[13px] w-6 h-6 grid place-items-center rounded hover:bg-th-hover opacity-0 group-hover:opacity-100">
            ↺
          </button>
        )}
      </div>
    </div>
  );
}

function KeybindingsSection() {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const categories = Array.from(new Set(KEYBINDING_DEFS.map((d) => d.category)));

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <SectionHeading title="Keybindings" desc="Click a shortcut to record a new combo, or press Escape to cancel." />
        <button onClick={() => resetAllCombos()} className="shrink-0 px-3 py-1.5 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4 mt-[-8px]">
          Reset All
        </button>
      </div>
      <div className="flex flex-col gap-5">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5 px-3">{cat}</p>
            <div className="flex flex-col gap-0.5">
              {KEYBINDING_DEFS.filter((d) => d.category === cat).map((def) => (
                <KeybindingRow key={def.id} def={def} recordingId={recordingId} onStartRecord={setRecordingId} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SectionId>("general");

  const renderSection = () => {
    switch (section) {
      case "general":
        return <GeneralSection />;
      case "appearance":
        return (
          <div>
            <SectionHeading title="Appearance" desc="Choose if Relay's appearance should be light or dark, or follow your computer's settings." />
            <AppearanceSettings />
          </div>
        );
      case "security":
        return (
          <div>
            <SectionHeading title="Security" />
            <ScriptSafetySettings />
          </div>
        );
      case "keybindings":
        return <KeybindingsSection />;
      case "account":
        return <AccountSection />;
      case "import-export":
        return <ImportExportSection />;
      case "mock-server":
        return <MockServerSection />;
      case "about":
        return <AboutSection />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[820px] h-[600px] max-h-[85vh] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-[200px] shrink-0 border-r border-th-border bg-th-bg flex flex-col py-4">
          <h2 className="text-[13px] font-semibold text-th-text-1 px-4 mb-3">Settings</h2>
          <nav className="flex flex-col gap-0.5 px-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-left transition-colors ${
                  section === s.id ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-2 hover:bg-th-hover hover:text-th-text-1"
                }`}
              >
                <span className="shrink-0">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-6">{renderSection()}</div>
          <div className="flex items-center justify-end px-6 py-3.5 border-t border-th-border">
            <button onClick={onClose} className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
