import React, { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import RequestPanel from "./components/RequestPanel";
import ResponsePanel from "./components/ResponsePanel";
import GrpcPanel from "./components/GrpcPanel";
import GrpcResponsePanel from "./components/GrpcResponsePanel";
import { EnvironmentBar } from "./components/EnvironmentModal";
import { WorkspaceProvider, useWorkspace } from "./store";
import { ThemeProvider } from "./lib/theme";
import { LayoutProvider, useLayout } from "./lib/layout";
import { pickProtoFolder, listProtoFilesInDir } from "./lib/tauri";

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

const SPLIT_MIN_W = 320;
const SPLIT_MAX_MARGIN_W = 320;
const SPLIT_DEFAULT_W = 560;

const SPLIT_MIN_H = 160;
const SPLIT_MAX_MARGIN_H = 160;
const SPLIT_DEFAULT_H = 340;

function WorkspaceSetupModal() {
  const { pendingWorkspaceSetup, confirmWorkspaceSetup, cancelWorkspaceSetup } = useWorkspace();
  const [name, setName] = useState("");

  useEffect(() => {
    setName(pendingWorkspaceSetup?.suggestedName || "");
  }, [pendingWorkspaceSetup]);

  if (!pendingWorkspaceSetup) return null;

  const handleConfirm = () => {
    confirmWorkspaceSetup(name);
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
  const { workspaceDir, openWorkspaceFolder } = useWorkspace();
  if (workspaceDir) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-th-accent-bg border-b border-th-border text-[12.5px]">
      <span className="text-th-accent-text">
        No workspace folder chosen — changes aren't saved to disk yet. Pick a folder to store this collection as git-friendly `.relay` files.
      </span>
      <button
        onClick={() => openWorkspaceFolder()}
        className="shrink-0 px-3 py-1 rounded-md bg-th-accent text-white hover:bg-th-accent-hover"
      >
        Choose Folder
      </button>
    </div>
  );
}

function Main() {
  const { workspace, tabs, activeTabId, updateDraft, saveTab, sendTab, updateGrpcDraft, sendGrpcTab, setProtoLibrary } = useWorkspace();
  const activeTab = tabs.find((t) => t.nodeId === activeTabId) || null;
  const { responseLayout } = useLayout();

  const [splitWidth, setSplitWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("relay-split-width"));
    return saved >= SPLIT_MIN_W ? saved : SPLIT_DEFAULT_W;
  });
  const [splitHeight, setSplitHeight] = useState<number>(() => {
    const saved = Number(localStorage.getItem("relay-split-height"));
    return saved >= SPLIT_MIN_H ? saved : SPLIT_DEFAULT_H;
  });
  const [resizingWidth, setResizingWidth] = useState(false);
  const [resizingHeight, setResizingHeight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeTabId) saveTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, saveTab]);

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
    return <ResponsePanel response={activeTab.response} loading={activeTab.loading} />;
  };

  return (
    <div className="flex h-screen w-screen bg-th-bg text-th-text-1 font-sans overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <WorkspaceFolderBanner />
        <EnvironmentBar />
        <TabBar />
        {activeTab ? (
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
                <div className="shrink-0 min-h-0" style={{ height: splitHeight }}>
                  {renderBottomPanel()}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 grid place-items-center text-th-text-4 text-[13px] font-mono">
            Select or create a request from the sidebar to get started
          </div>
        )}
      </div>
      <UnsavedModal />
      <WorkspaceSetupModal />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LayoutProvider>
        <WorkspaceProvider>
          <Main />
        </WorkspaceProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}
