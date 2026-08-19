import React, { useMemo, useState } from "react";
import { parseCurlCommand } from "../lib/curlImport";
import { RequestData } from "../types";

const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-rose-400",
  HEAD: "text-slate-400",
  OPTIONS: "text-slate-400",
};

const PLACEHOLDER = `curl --request POST \\
  --url https://api.example.com/users \\
  --header 'content-type: application/json' \\
  --data '{
  "name": "Ada"
}'`;

export default function CurlImportModal({ onCreate, onClose }: { onCreate: (name: string, request: RequestData) => void; onClose: () => void }) {
  const [raw, setRaw] = useState("");
  const [name, setName] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return parseCurlCommand(raw);
    } catch {
      return null;
    }
  }, [raw]);

  const effectiveName = name ?? parsed?.name ?? "";

  const handleCreate = () => {
    if (!parsed) return;
    onCreate(effectiveName.trim() || parsed.name, parsed.request);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[560px] max-h-[82vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-semibold text-th-text-1">New Request From cURL</h2>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="px-5 pb-3 flex-1 overflow-auto flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-mono text-th-text-3 mb-1.5 block">cURL command</label>
            <textarea
              autoFocus
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              className="w-full h-40 bg-th-bg border border-th-border-input rounded-md px-3 py-2 text-[12.5px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus resize-y"
            />
          </div>

          {raw.trim() && !parsed && (
            <p className="text-[12px] text-rose-400">Couldn't find a URL in this command — check it starts with "curl" and has a URL in it.</p>
          )}

          {parsed && (
            <div className="border border-th-border rounded-md bg-th-bg px-3 py-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className={`text-[11.5px] font-mono font-bold shrink-0 ${METHOD_COLOR[parsed.request.method] || "text-th-text-2"}`}>{parsed.request.method}</span>
                <span className="text-[12px] font-mono text-th-text-2 truncate">{parsed.request.url}</span>
              </div>
              <input
                value={effectiveName}
                onChange={(e) => setName(e.target.value)}
                placeholder="Request name"
                className="bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[12.5px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
              />
              <p className="text-[11px] text-th-text-4 font-mono">
                {parsed.request.headers.filter((h) => h.key.trim()).length} header(s) · auth: {parsed.request.auth.type} · body: {parsed.request.bodyMode}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-th-border">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-[12.5px] text-th-text-2 hover:text-th-text-1 hover:bg-th-hover">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!parsed}
            className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-40 disabled:cursor-default"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
