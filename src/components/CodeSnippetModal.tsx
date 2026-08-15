import React, { useEffect, useMemo, useRef, useState } from "react";
import { RequestData } from "../types";
import { SNIPPET_LANGS, SnippetLang, generateSnippet, toSnippetRequest } from "../lib/codegen";
import { useWorkspace } from "../store";

function LangDropdown({ value, onChange }: { value: SnippetLang; onChange: (l: SnippetLang) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        className="flex items-center gap-2 bg-th-bg border border-th-border-input rounded-md px-2.5 py-1.5 text-[12.5px] font-mono text-th-text-1 hover:border-th-text-4 min-w-[190px]"
      >
        <span className="flex-1 text-left truncate">{value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-th-text-3 shrink-0">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[190px]">
          {SNIPPET_LANGS.map((l) => (
            <button
              key={l}
              onClick={() => { onChange(l); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-[12.5px] font-mono hover:bg-th-hover flex items-center gap-2 ${l === value ? "text-th-accent-text" : "text-th-text-1"}`}
            >
              {l === value && <span className="text-[10px]">✓</span>}
              <span className={l === value ? "" : "pl-[14px]"}>{l}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CodeSnippetModal({ draft, onClose }: { draft: RequestData; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const [lang, setLang] = useState<SnippetLang>("cURL");
  const [copied, setCopied] = useState(false);

  const vars = useMemo(() => {
    const merged: Record<string, string> = {};
    workspace.variables.forEach((r) => {
      if (r.key.trim()) merged[r.key] = r.value;
    });
    const activeEnv = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
    if (activeEnv) {
      activeEnv.variables.forEach((r) => {
        if (r.key.trim()) merged[r.key] = r.value;
      });
    }
    return merged;
  }, [workspace.variables, workspace.environments, workspace.activeEnvironmentId]);

  const snippet = useMemo(() => generateSnippet(lang, toSnippetRequest(draft, vars)), [lang, draft, vars]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-semibold text-th-text-1">Code Snippet</h2>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="px-5 pb-3 flex items-center justify-between gap-2">
          <LangDropdown value={lang} onChange={setLang} />
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 pb-5">
          <pre className="bg-th-bg border border-th-border rounded-md p-3.5 text-[12.5px] font-mono text-th-text-1 whitespace-pre overflow-x-auto overflow-y-hidden leading-relaxed">
            {snippet}
          </pre>
        </div>
      </div>
    </div>
  );
}
