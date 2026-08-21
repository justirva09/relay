import React from "react";
import { useWorkspace } from "../store";

// the actual picker UI with no modal chrome, reused by the standalone
// ScriptSafetyModal (toolbar shield icon) and Settings' "Security" section
export function ScriptSafetySettings() {
  const { safeMode, setSafeMode } = useWorkspace();

  return (
    <div>
      <p className="text-[12px] text-th-text-3 mb-4">
        Controls where pre-request and test scripts run — including ones from a collection someone else authored.
      </p>

      <button
        onClick={() => setSafeMode(true)}
        className={`w-full text-left border rounded-lg p-3.5 mb-3 transition-colors ${
          safeMode ? "border-emerald-400/50 bg-emerald-400/10" : "border-th-border-input hover:border-th-text-4"
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`shrink-0 h-4 w-4 rounded-full border-2 grid place-items-center ${safeMode ? "border-emerald-400" : "border-th-text-4"}`}>
            {safeMode && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
          </span>
          <span className="text-[13.5px] font-semibold text-th-text-1">Safe Mode</span>
          <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-400">Recommended</span>
        </div>
        <p className="text-[12px] text-th-text-3 leading-relaxed pl-6">
          Scripts run inside an isolated sandbox — no access to your filesystem, and no way to call Relay's own
          backend commands (Git, the mock server, file storage).
        </p>
      </button>

      <button
        onClick={() => setSafeMode(false)}
        className={`w-full text-left border rounded-lg p-3.5 transition-colors ${
          !safeMode ? "border-amber-400/50 bg-amber-400/10" : "border-th-border-input hover:border-th-text-4"
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`shrink-0 h-4 w-4 rounded-full border-2 grid place-items-center ${!safeMode ? "border-amber-400" : "border-th-text-4"}`}>
            {!safeMode && <span className="h-2 w-2 rounded-full bg-amber-400" />}
          </span>
          <span className="text-[13.5px] font-semibold text-th-text-1">Developer Mode</span>
        </div>
        <div className="pl-6">
          <p className="inline-block text-[11.5px] font-mono text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-2 py-1 mb-2">
            Use only if you trust whoever wrote this collection
          </p>
          <p className="text-[12px] text-th-text-3 leading-relaxed">
            Scripts run with full access to this app — can read/write files, and reach any of Relay's own
            backend commands directly.
          </p>
        </div>
      </button>

      <p className="text-[11px] text-th-text-4 mt-4">
        This is a local setting, per workspace folder — it's never saved into the workspace's own committed files.
      </p>
    </div>
  );
}

export default function ScriptSafetyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[460px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[15px] font-semibold text-th-text-1">JavaScript Sandbox</h2>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">
            ×
          </button>
        </div>
        <ScriptSafetySettings />
      </div>
    </div>
  );
}
