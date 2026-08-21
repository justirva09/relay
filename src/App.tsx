import React, { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import RequestPanel from "./components/RequestPanel";
import ResponsePanel from "./components/ResponsePanel";
import GrpcPanel from "./components/grpc/GrpcPanel";
import GrpcResponsePanel from "./components/grpc/GrpcResponsePanel";
import OverviewPage from "./components/OverviewPage";
import BranchComparePanel from "./components/BranchComparePanel";
import RunnerPanel from "./components/RunnerPanel";
import { EnvironmentBar } from "./components/EnvironmentModal";
import { WorkspaceProvider, useWorkspace } from "./store";
import { ThemeProvider } from "./lib/theme";
import { LayoutProvider, useLayout } from "./lib/layout";
import { pickProtoFolder, listProtoFilesInDir } from "./lib/tauri";
import VersionGate from "./components/VersionGate";
import { uid, nameExample } from "./types";
import TreePickerModal from "./components/TreePickerModal";
import WelcomeModal from "./components/WelcomeModal";
import Footer from "./components/Footer";
import { TreeNode } from "./types";
import { registerAction, runAction, getEffectiveCombo, comboFromEvent, KEYBINDING_DEFS, getActiveSearchRegion } from "./lib/keybindings";
import { getLicenseState, refreshLicense } from "./lib/license";

function UnsavedModal() {
  const { pendingCloseId, confirmCloseTab, workspace } = useWorkspace();
  if (!pendingCloseId) return null;

  const findName = (nodes: typeof workspace.tree): string | null => {
    for (const n of nodes) {
      if (n.id === pendingCloseId) return n.name;
      if (n.kind === "folder") {
        const found = findName(n.children);
        if (found) return found;
      }
    }
    return null;
  };
  const name = findName(workspace.tree) || "Untitled";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={() => confirmCloseTab("cancel")}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[380px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[14px] font-semibold text-th-text-1 mb-2">Unsaved Changes</h3>
        <p className="text-[13px] text-th-text-2 mb-5">
          <span className="text-th-text-1 font-mono">"{name}"</span> has unsaved changes. Save before closing?
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => confirmCloseTab("cancel")}
            className="px-3 py-1.5 rounded text-[12.5px] text-th-text-2 hover:text-th-text-1 hover:bg-th-hover"
          >
            Cancel
          </button>
          <button
            onClick={() => confirmCloseTab("discard")}
            className="px-3 py-1.5 rounded text-[12.5px] text-rose-400 hover:bg-rose-400/10"
          >
            Discard
          </button>
          <button
            onClick={() => confirmCloseTab("save")}
            className="px-3 py-1.5 rounded text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}

function findFolderName(nodes: TreeNode[], id: string): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    if (n.kind === "folder") {
      const found = findFolderName(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Renders the import/export request picker and its result toast globally,
// since import can be triggered either from Settings (whole-collection) or
// from the Sidebar's per-folder "Import Here" menu.
function ImportExportModals() {
  const { workspace, pendingImport, confirmImport, cancelImport, pendingExport, confirmExport, cancelExport, importError, dismissImportError } = useWorkspace();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const targetFolderName = pendingImport?.targetFolderId ? findFolderName(workspace.tree, pendingImport.targetFolderId) : null;

  return (
    <>
      {pendingImport && (
        <TreePickerModal
          tree={pendingImport.tree}
          title={targetFolderName ? `Select requests to import into "${targetFolderName}"` : "Select requests to import"}
          confirmLabel="Import"
          onConfirm={(ids) => {
            const stats = confirmImport(ids);
            setToast(`Sync import: ${stats.added} added, ${stats.updated} updated.`);
          }}
          onCancel={cancelImport}
        />
      )}
      {pendingExport && (
        <TreePickerModal
          tree={workspace.tree}
          title="Select requests to export"
          confirmLabel="Export"
          onConfirm={async (ids) => {
            const result = await confirmExport(ids);
            if (!result) return;
            setToast(
              result.skippedGrpcCount > 0
                ? `Collection exported. ${result.skippedGrpcCount} gRPC request${result.skippedGrpcCount === 1 ? "" : "s"} skipped — Postman does not support gRPC in collection exports.`
                : "Collection exported."
            );
          }}
          onCancel={cancelExport}
        />
      )}
      {importError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={dismissImportError}>
          <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[360px] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-semibold text-th-text-1 mb-2">Import failed</h3>
            <p className="text-[13px] text-th-text-2 mb-5">{importError}</p>
            <div className="flex justify-end">
              <button onClick={dismissImportError} className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl px-4 py-2 text-[12.5px] text-th-text-1">
          {toast}
        </div>
      )}
    </>
  );
}

const SPLIT_MIN_W = 320;
const SPLIT_MAX_MARGIN_W = 320;
const SPLIT_DEFAULT_W = 560;

// Low enough to let the response panel be dragged fully out of the way when
// you just want the request/Examples editor to have the full height instead
// — not a hard floor like SPLIT_MAX_MARGIN_H is for the *top* panel.
const SPLIT_MIN_H = 0;
const SPLIT_MAX_MARGIN_H = 160;
const SPLIT_DEFAULT_H = 340;

function WorkspaceSetupModal() {
  const { pendingWorkspaceSetup, confirmWorkspaceSetup, cancelWorkspaceSetup } = useWorkspace();
  const [name, setName] = useState("");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setName(pendingWorkspaceSetup?.suggestedName || "");
    setHidden(!!pendingWorkspaceSetup?.folderHasOtherFiles);
  }, [pendingWorkspaceSetup]);

  if (!pendingWorkspaceSetup) return null;

  const forcedHidden = pendingWorkspaceSetup.folderHasOtherFiles;

  const handleConfirm = () => {
    confirmWorkspaceSetup(name, hidden);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={cancelWorkspaceSetup}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[380px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[14px] font-semibold text-th-text-1 mb-2">Name This Workspace</h3>
        <p className="text-[12.5px] text-th-text-3 mb-4">
          Stored inside the workspace files, so it shows up the same for everyone who clones this folder from git.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
          className="w-full bg-th-bg border border-th-border-input rounded-md px-3 py-2 text-[13px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus mb-4"
        />

        <label className={`flex items-start gap-2.5 mb-4 ${forcedHidden ? "opacity-70" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            checked={hidden}
            disabled={forcedHidden}
            onChange={(e) => setHidden(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--c-accent)] shrink-0"
          />
          <span className="text-[12px] text-th-text-3">
            Keep Relay's files in a hidden <span className="font-mono text-th-text-2">.relay/</span> folder
            {forcedHidden ? (
              <> — required here since this folder already has other files, so nothing outside <span className="font-mono text-th-text-2">.relay/</span> is ever touched.</>
            ) : (
              <> instead of directly in this folder. Turn this on if you're pointing Relay at an existing project's folder.</>
            )}
          </span>
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={cancelWorkspaceSetup}
            className="px-3 py-1.5 rounded text-[12.5px] text-th-text-2 hover:text-th-text-1 hover:bg-th-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-3 py-1.5 rounded text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceFolderBanner() {
  const { workspaceDir, openWorkspaceFolder, createWorkspace, workspaceOpenError, dismissWorkspaceOpenError } = useWorkspace();
  if (workspaceDir) return null;
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2 bg-th-accent-bg border-b border-th-border text-[12.5px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-th-accent-text">
          No workspace folder chosen — changes aren't saved to disk yet.
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => openWorkspaceFolder()}
            className="px-3 py-1 rounded-md border border-th-accent-border text-th-accent-text hover:bg-th-accent-bg"
          >
            Open Folder
          </button>
          <button
            onClick={() => createWorkspace()}
            className="px-3 py-1 rounded-md bg-th-accent text-white hover:bg-th-accent-hover"
          >
            New Workspace
          </button>
        </div>
      </div>
      {workspaceOpenError && (
        <div className="flex items-center justify-between gap-3 text-rose-500">
          <span>{workspaceOpenError}</span>
          <button onClick={dismissWorkspaceOpenError} className="shrink-0 hover:text-rose-600">×</button>
        </div>
      )}
    </div>
  );
}

function Main() {
  const { workspace, tabs, activeTabId, openTick, updateDraft, saveTab, sendTab, updateGrpcDraft, sendGrpcTab, setProtoLibrary, compareOpen, closeCompare, openCompare, runnerOpen, openRunner, closeRunner, closeTab, closeAllTabs, setActiveTab } = useWorkspace();
  const activeTab = tabs.find((t) => t.nodeId === activeTabId) || null;
  const { responseLayout } = useLayout();
  const [showOverview, setShowOverview] = useState(false);

  // Opportunistic refresh — if a session is already cached from a previous
  // run, re-check entitlement on launch instead of only ever trusting
  // whatever was last verified (could be a lapsed subscription by now).
  // Failure here just leaves the last verified license in place (see
  // refreshLicense's own comment) rather than blocking startup on it.
  useEffect(() => {
    if (getLicenseState().session) refreshLicense();
  }, []);

  // openTick bumps on every openTab() call, even re-clicking the tab that's
  // already active — activeTabId alone wouldn't change in that case, leaving
  // the overview stuck on screen after picking the same request again.
  useEffect(() => {
    if (openTick > 0) setShowOverview(false);
  }, [openTick]);

  // Same reasoning applies to Compare — it took over the whole content area,
  // so clicking any request in the sidebar should dismiss it like every
  // other full-area view does, not leave it stuck until the X is clicked.
  useEffect(() => {
    if (openTick > 0) closeCompare();
  }, [openTick, closeCompare]);

  // Same reasoning applies to the Runner.
  useEffect(() => {
    if (openTick > 0) closeRunner();
  }, [openTick, closeRunner]);

  useEffect(() => {
    if (!compareOpen && !runnerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeCompare();
        closeRunner();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [compareOpen, closeCompare, runnerOpen, closeRunner]);

  const [splitWidth, setSplitWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("relay-split-width"));
    return saved >= SPLIT_MIN_W ? saved : SPLIT_DEFAULT_W;
  });
  const [splitHeight, setSplitHeight] = useState<number>(() => {
    // Number(null) is 0, which — now that SPLIT_MIN_H is itself 0 to allow a
    // fully collapsed panel — would be indistinguishable from "never saved
    // anything yet" and silently default to a collapsed panel on first
    // launch. Check for the raw stored string first.
    const raw = localStorage.getItem("relay-split-height");
    if (raw === null) return SPLIT_DEFAULT_H;
    const saved = Number(raw);
    return saved >= SPLIT_MIN_H ? saved : SPLIT_DEFAULT_H;
  });
  const [resizingWidth, setResizingWidth] = useState(false);
  const [resizingHeight, setResizingHeight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Registers this component's own action handlers — other components
  // (Sidebar, EnvironmentBar) register theirs independently wherever their
  // relevant state actually lives; see keybindings.ts's registry.
  useEffect(() => {
    const unregisters = [
      registerAction("tab.save", () => activeTabId && saveTab(activeTabId)),
      registerAction("tab.saveAll", () => tabs.forEach((t) => saveTab(t.nodeId))),
      registerAction("tab.close", () => activeTabId && closeTab(activeTabId)),
      registerAction("tab.closeAll", () => closeAllTabs()),
      registerAction("tab.next", () => {
        if (!tabs.length) return;
        const i = tabs.findIndex((t) => t.nodeId === activeTabId);
        setActiveTab(tabs[(i + 1) % tabs.length].nodeId);
      }),
      registerAction("tab.previous", () => {
        if (!tabs.length) return;
        const i = tabs.findIndex((t) => t.nodeId === activeTabId);
        setActiveTab(tabs[(i - 1 + tabs.length) % tabs.length].nodeId);
      }),
      registerAction("request.send", () => {
        if (!activeTab) return;
        if (activeTab.kind === "grpc") sendGrpcTab(activeTab.nodeId);
        else sendTab(activeTab.nodeId);
      }),
      registerAction("view.compareBranches", () => openCompare()),
      registerAction("view.runner", () => openRunner()),
    ];
    return () => unregisters.forEach((u) => u());
  }, [activeTabId, tabs, activeTab, saveTab, closeTab, closeAllTabs, setActiveTab, sendTab, sendGrpcTab, openCompare, openRunner]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      const combo = comboFromEvent(e);
      if (!combo) return;
      // request.send (mod+enter) is deliberately allowed while typing — it's
      // the whole point of the shortcut, used constantly from inside the
      // URL bar/body editor. Everything else stays disabled while typing so
      // e.g. plain letters bound to an action don't fire while filling a form.
      const allowWhileTyping = combo === getEffectiveCombo("request.send");
      if (typing && !allowWhileTyping) return;
      for (const def of KEYBINDING_DEFS) {
        if (combo !== getEffectiveCombo(def.id)) continue;
        // "Search" means the response pane's own search when that's the
        // pane you were last in — see keybindings.ts's activeSearchRegion.
        if (def.id === "sidebar.search" && getActiveSearchRegion() === "response" && runAction("response.search")) {
          e.preventDefault();
          return;
        }
        if (runAction(def.id)) {
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!resizingWidth) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = Math.min(rect.width - SPLIT_MAX_MARGIN_W, Math.max(SPLIT_MIN_W, e.clientX - rect.left));
      setSplitWidth(next);
    };
    const onUp = () => {
      setResizingWidth(false);
      setSplitWidth((w) => {
        localStorage.setItem("relay-split-width", String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingWidth]);

  useEffect(() => {
    if (!resizingHeight) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = Math.min(rect.height - SPLIT_MAX_MARGIN_H, Math.max(SPLIT_MIN_H, rect.bottom - e.clientY));
      setSplitHeight(next);
    };
    const onUp = () => {
      setResizingHeight(false);
      setSplitHeight((h) => {
        localStorage.setItem("relay-split-height", String(h));
        return h;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingHeight]);

  const renderTopPanel = () => {
    if (!activeTab) return null;
    if (activeTab.kind === "grpc") {
      const protoFiles = workspace.protoLibrary;

      const handleImportProto = async () => {
        const dir = await pickProtoFolder();
        if (!dir) return;
        const found = await listProtoFilesInDir(dir);
        const merged = new Map(protoFiles.map((f) => [f.name, f] as const));
        for (const f of found) merged.set(f.name, f);
        setProtoLibrary(Array.from(merged.values()));
      };

      const handleRemoveProto = (name: string) => {
        setProtoLibrary(protoFiles.filter((f) => f.name !== name));
        if (activeTab.draft.activeProtoFile === name) {
          updateGrpcDraft(activeTab.nodeId, { activeProtoFile: undefined, service: "", method: "" });
        }
      };

      return (
        <GrpcPanel
          draft={activeTab.draft}
          streaming={activeTab.streaming}
          onChange={(patch) => updateGrpcDraft(activeTab.nodeId, patch)}
          onSend={() => sendGrpcTab(activeTab.nodeId)}
          protoFiles={protoFiles}
          onImportProto={handleImportProto}
          onRemoveProto={handleRemoveProto}
        />
      );
    }
    return (
      <RequestPanel
        nodeId={activeTab.nodeId}
        draft={activeTab.draft}
        loading={activeTab.loading}
        dirty={activeTab.dirty}
        onChange={(patch) => updateDraft(activeTab.nodeId, patch)}
        onSend={() => sendTab(activeTab.nodeId)}
        onSave={() => saveTab(activeTab.nodeId)}
      />
    );
  };

  const renderBottomPanel = () => {
    if (!activeTab) return null;
    if (activeTab.kind === "grpc") {
      return <GrpcResponsePanel log={activeTab.log} streaming={activeTab.streaming} lastResponse={activeTab.lastResponse} />;
    }
    const response = activeTab.response;
    return (
      <ResponsePanel
        response={response}
        loading={activeTab.loading}
        onSaveExample={
          response && response.status != null
            ? () => {
                let body = response.body;
                try {
                  body = JSON.stringify(JSON.parse(body), null, 2);
                } catch {
                  // not JSON — save the raw body as-is
                }
                const example = {
                  id: uid(),
                  name: nameExample(response.status!, response.statusText),
                  status: response.status!,
                  headers: response.headers,
                  body,
                  isDefault: activeTab.draft.examples.length === 0,
                };
                updateDraft(activeTab.nodeId, { examples: [...activeTab.draft.examples, example] });
              }
            : undefined
        }
      />
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-th-bg text-th-text-1 font-sans overflow-hidden">
    <div className="flex-1 flex min-h-0">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <WorkspaceFolderBanner />
        <EnvironmentBar onShowOverview={() => setShowOverview(true)} />
        <TabBar />
        {runnerOpen ? (
          <RunnerPanel onClose={closeRunner} />
        ) : compareOpen ? (
          <BranchComparePanel onClose={closeCompare} />
        ) : !activeTab || showOverview ? (
          <OverviewPage />
        ) : (
          <div ref={containerRef} className={`flex-1 flex min-h-0 ${responseLayout === "bottom" ? "flex-col" : ""}`}>
            {responseLayout === "side" ? (
              <>
                <div className="overflow-y-auto overflow-x-hidden min-h-0 shrink-0" style={{ width: splitWidth }}>
                  {renderTopPanel()}
                </div>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setResizingWidth(true); }}
                  className={`w-1 shrink-0 cursor-col-resize hover:bg-th-accent-border ${resizingWidth ? "bg-th-accent-border" : "bg-th-border"}`}
                />
                <div className="flex-1 min-w-0 min-h-0">
                  {renderBottomPanel()}
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
                  {renderTopPanel()}
                </div>
                <div
                  onMouseDown={(e) => { e.preventDefault(); setResizingHeight(true); }}
                  className={`h-1 shrink-0 cursor-row-resize hover:bg-th-accent-border ${resizingHeight ? "bg-th-accent-border" : "bg-th-border"}`}
                />
                <div className="shrink-0 min-h-0 overflow-hidden" style={{ height: splitHeight }}>
                  {renderBottomPanel()}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <UnsavedModal />
      <WorkspaceSetupModal />
      <ImportExportModals />
      <WelcomeModal />
    </div>
    <Footer />
    </div>
  );
}

export default function App() {
  return (
    <VersionGate>
      <ThemeProvider>
        <LayoutProvider>
          <WorkspaceProvider>
            <Main />
          </WorkspaceProvider>
        </LayoutProvider>
      </ThemeProvider>
    </VersionGate>
  );
}
