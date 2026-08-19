import React, { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import pkg from "../../package.json";
import { DevLogEntry, subscribeDevConsole } from "../lib/devConsole";
import DevToolsPanel from "./DevToolsPanel";

export default function Footer() {
  const [version, setVersion] = useState<string | null>(pkg.version);
  const [entries, setEntries] = useState<DevLogEntry[]>([]);
  const [showDevTools, setShowDevTools] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => subscribeDevConsole(setEntries), []);

  return (
    <>
      <div className="h-6 shrink-0 flex items-center justify-between px-3 border-t border-th-border bg-th-bg text-[11px] font-mono text-th-text-4">
        <span>v{version || "—"}</span>
        <button
          onClick={() => setShowDevTools((s) => !s)}
          className={`flex items-center gap-1.5 px-1.5 -my-1 py-1 rounded hover:text-th-text-1 hover:bg-th-hover ${showDevTools ? "text-th-text-1" : ""}`}
        >
          Dev Tools
          {entries.length > 0 && (
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" title={`${entries.length} error(s) captured`} />
          )}
        </button>
      </div>
      {showDevTools && <DevToolsPanel onClose={() => setShowDevTools(false)} />}
    </>
  );
}
