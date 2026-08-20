import { useWorkspace } from "../../store";
import { useLayout } from "../../lib/layout";
import { SectionHeading } from "./shared";

export function GeneralSection() {
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
