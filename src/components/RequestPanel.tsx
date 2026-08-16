import React, { useEffect, useMemo, useRef, useState } from "react";
import { Method, RequestData, buildUrlFromParams, parseQueryToRows, parsePathParamsFromUrl } from "../types";
import KeyValueEditor, { ValueInput } from "./KeyValueEditor";
import CodeEditor from "./CodeEditor";
import CodeSnippetModal from "./CodeSnippetModal";
import { PM_PRE_COMPLETIONS, PM_TEST_COMPLETIONS } from "../lib/pmCompletions";
import { useWorkspace } from "../store";
import { useVariableMenu } from "../lib/useVariableMenu";
import VariableMenuList from "./VariableMenuList";
import { highlightUrlTokens } from "../lib/urlHighlight";

function UrlInput({ value, onChange, onKeyDown, placeholder, variables }: {
  value: string;
  onChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  variables?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const { menu, recompute, close, move, hover, apply } = useVariableMenu(variables);

  const syncScroll = () => {
    requestAnimationFrame(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
      }
    });
  };

  const select = (item: string) => {
    const result = apply(value, item);
    if (!result) return;
    onChange(result.next);
    close();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (inputRef.current) inputRef.current.selectionStart = inputRef.current.selectionEnd = result.cursor;
    });
  };

  return (
    <div className="flex-1 min-w-0 relative">
      <div
        className={`relative overflow-hidden bg-th-surface border rounded-md ${focused ? "border-th-border-focus" : "border-th-border-input"}`}
        onClick={() => inputRef.current?.focus()}
      >
        <div ref={overlayRef} className="px-3 py-2 text-[13px] font-mono whitespace-pre overflow-hidden pointer-events-none" aria-hidden>
          {value ? highlightUrlTokens(value, true) : <span className="text-th-text-4">{placeholder}</span>}
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); syncScroll(); recompute(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onKeyDown={(e) => {
            if (menu) {
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); move(-1); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(menu.items[menu.activeIndex]); return; }
              if (e.key === "Escape") { e.preventDefault(); close(); return; }
            }
            onKeyDown(e);
          }}
          onKeyUp={(e) => {
            syncScroll();
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) recompute(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          }}
          onScroll={syncScroll}
          onFocus={() => { setFocused(true); syncScroll(); }}
          onBlur={() => { setFocused(false); close(); }}
          className="absolute inset-0 w-full h-full px-3 py-2 text-[13px] font-mono bg-transparent text-transparent caret-slate-200 focus:outline-none"
          spellCheck={false}
        />
      </div>
      {menu && (
        <VariableMenuList
          items={menu.items}
          activeIndex={menu.activeIndex}
          onHover={hover}
          onSelect={select}
          style={{ top: "100%", left: `${menu.col}ch`, marginTop: "4px" }}
        />
      )}
    </div>
  );
}

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLOR: Record<string, { text: string; bg: string; ring: string }> = {
  GET: { text: "text-emerald-400", bg: "bg-emerald-400/10", ring: "ring-emerald-400/30" },
  POST: { text: "text-sky-400", bg: "bg-sky-400/10", ring: "ring-sky-400/30" },
  PUT: { text: "text-amber-400", bg: "bg-amber-400/10", ring: "ring-amber-400/30" },
  PATCH: { text: "text-violet-400", bg: "bg-violet-400/10", ring: "ring-violet-400/30" },
  DELETE: { text: "text-rose-400", bg: "bg-rose-400/10", ring: "ring-rose-400/30" },
  HEAD: { text: "text-slate-400", bg: "bg-slate-400/10", ring: "ring-slate-400/30" },
  OPTIONS: { text: "text-slate-400", bg: "bg-slate-400/10", ring: "ring-slate-400/30" },
};

const METHOD_TEXT: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-rose-400",
  HEAD: "text-slate-400",
  OPTIONS: "text-slate-400",
};

function MethodDropdown({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const color = METHOD_COLOR[value] || METHOD_COLOR.GET;

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
        className={`font-mono text-[13px] font-semibold px-2.5 py-2 rounded-md ring-1 border border-transparent cursor-pointer flex items-center gap-1.5 ${color.text} ${color.bg} ${color.ring}`}
      >
        {value}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="opacity-60">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[120px]">
          {METHODS.map((m) => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-[13px] font-mono font-semibold hover:bg-th-hover flex items-center gap-2 ${METHOD_TEXT[m]}`}
            >
              {value === m && <span className="text-[10px]">✓</span>}
              <span className={value === m ? "" : "pl-[18px]"}>{m}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function computeAutoHeaders(draft: RequestData): [string, string][] {
  const userHas = (name: string) => draft.headers.some((h) => h.enabled && h.key.trim().toLowerCase() === name);
  const rows: [string, string][] = [["Host", "<calculated when request is sent>"]];
  if (!userHas("user-agent")) rows.push(["User-Agent", "Relay/0.1.0"]);
  if (draft.bodyMode === "json" && !userHas("content-type")) rows.push(["Content-Type", "application/json"]);
  if (draft.bodyMode !== "none") rows.push(["Content-Length", "<calculated when request is sent>"]);
  return rows;
}

function AutoHeadersList({ draft }: { draft: RequestData }) {
  const [show, setShow] = useState(false);
  const autoHeaders = computeAutoHeaders(draft);

  return (
    <div className="flex flex-col gap-1.5 mb-2">
      <button
        onClick={() => setShow((v) => !v)}
        className="self-start text-[11px] font-mono text-th-text-3 hover:text-th-accent-text"
      >
        {show ? "Hide" : "Show"} auto-generated headers ({autoHeaders.length})
      </button>
      {show && (
        <div className="flex flex-col gap-0.5 bg-th-bg border border-th-border rounded-md px-3 py-2">
          {autoHeaders.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-[12.5px] font-mono">
              <input type="checkbox" checked disabled className="accent-th-accent opacity-60" />
              <span className="text-th-text-3 w-[130px] shrink-0 truncate">{k}</span>
              <span className={`truncate ${v.startsWith("<") ? "text-th-text-4 italic" : "text-th-text-2"}`}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PRE_PLACEHOLDER = `// runs before the request is sent
// pm.environment.set("token", "abc123")
// pm.request.headers.add({ key: "X-Trace", value: Date.now() })
// pm.request.url = pm.request.url + "&debug=1"`;

const TEST_PLACEHOLDER = `// runs after the response comes back
// pm.test("status is 200", () => pm.expect(pm.response.code).to.equal(200))
// pm.test("has id", () => pm.expect(pm.response.json().id).to.be.a("number"))
// pm.environment.set("lastId", pm.response.json().id)`;

interface Props {
  draft: RequestData;
  loading: boolean;
  dirty: boolean;
  onChange: (patch: Partial<RequestData>) => void;
  onSend: () => void;
  onSave: () => void;
}

export default function RequestPanel({ draft, loading, dirty, onChange, onSend, onSave }: Props) {
  const [reqTab, setReqTab] = useState<"params" | "headers" | "body" | "scripts">("params");
  const [scriptTab, setScriptTab] = useState<"pre" | "post">("pre");
  const [showSnippet, setShowSnippet] = useState(false);
  const methodColor = METHOD_COLOR[draft.method] || METHOD_COLOR.GET;

  const { workspace } = useWorkspace();
  const variableNames = useMemo(() => {
    const names = new Map<string, true>();
    for (const v of workspace.variables) if (v.key.trim()) names.set(v.key, true);
    const activeEnv = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
    if (activeEnv) for (const v of activeEnv.variables) if (v.key.trim()) names.set(v.key, true);
    return Array.from(names.keys());
  }, [workspace.variables, workspace.environments, workspace.activeEnvironmentId]);

  const handleUrlChange = (val: string) => {
    onChange({
      url: val,
      params: parseQueryToRows(val, draft.params),
      pathParams: parsePathParamsFromUrl(val, draft.pathParams),
    });
  };
  const handleParamsChange = (rows: RequestData["params"]) => {
    onChange({ params: rows, url: buildUrlFromParams(draft.url, rows) });
  };
  const handlePathParamChange = (id: string, value: string) => {
    onChange({ pathParams: draft.pathParams.map((r) => (r.id === id ? { ...r, value } : r)) });
  };

  const enabledParams = draft.params.filter((p) => p.enabled && p.key.trim()).length;
  const enabledHeaders = draft.headers.filter((h) => h.enabled && h.key.trim()).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 flex items-center gap-2">
        <MethodDropdown value={draft.method} onChange={(m) => onChange({ method: m })} />
        <UrlInput
          value={draft.url}
          onChange={handleUrlChange}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="https://api.example.com/endpoint?key=value"
          variables={variableNames}
        />
        <button
          title="Code snippet"
          onClick={() => setShowSnippet(true)}
          className="h-[36px] w-[36px] grid place-items-center rounded-md border border-transparent ring-1 ring-th-border-input text-th-text-3 hover:text-th-accent-text hover:bg-th-hover shrink-0"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
        <button
          onClick={onSave}
          disabled={!dirty}
          className={`px-3 py-2 rounded-md text-[13px] font-semibold border border-transparent transition-colors shrink-0 ${
            dirty ? "bg-th-surface text-th-text-1 ring-1 ring-th-border-input hover:bg-th-hover" : "bg-th-surface/50 text-th-text-4 ring-1 ring-th-border cursor-default"
          }`}
        >
          Save
        </button>
        <button
          onClick={onSend}
          disabled={loading}
          className="px-4 py-2 rounded-md text-[13px] font-semibold border border-transparent bg-th-accent text-white hover:bg-th-accent-hover transition-colors shrink-0 disabled:opacity-60"
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>

      <div className="px-4 mt-4">
        <div className="flex items-center gap-4 border-b border-th-border text-[12.5px] font-mono overflow-x-auto overflow-y-hidden">
          {[
            ["params", `Params${enabledParams ? ` (${enabledParams})` : ""}`],
            ["headers", `Headers${enabledHeaders ? ` (${enabledHeaders})` : ""}`],
            ["body", "Body"],
            ["scripts", "Scripts"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setReqTab(key as any)}
              className={`pb-2 -mb-px border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                reqTab === key ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"
              }`}
            >
              {label}
              {key === "scripts" && (draft.preScript.trim() || draft.testScript.trim()) && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 flex-1 min-h-0 flex flex-col">
        {reqTab === "params" && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Query Params</p>
              <KeyValueEditor rows={draft.params} onChangeRows={handleParamsChange} placeholderKey="param" placeholderVal="value" variables={variableNames} />
            </div>
            {draft.pathParams.length > 0 && (
              <div>
                <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Path Variables</p>
                <div className="flex flex-col gap-1.5">
                  {draft.pathParams.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span
                        className="flex-1 min-w-0 truncate px-2.5 py-1.5 text-[13px] font-mono text-sky-400"
                        title={p.key}
                      >
                        :{p.key}
                      </span>
                      <ValueInput
                        value={p.value}
                        onChange={(v) => handlePathParamChange(p.id, v)}
                        placeholder="value"
                        variables={variableNames}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {reqTab === "headers" && (
          <>
            <AutoHeadersList draft={draft} />
            <KeyValueEditor rows={draft.headers} onChangeRows={(rows) => onChange({ headers: rows })} placeholderKey="header" placeholderVal="value" variables={variableNames} />
          </>
        )}
        {reqTab === "body" && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              {(["none", "json", "text"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onChange({ bodyMode: m })}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-mono ring-1 transition-colors ${
                    draft.bodyMode === m ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {draft.bodyMode !== "none" && (
              <div className="flex flex-col gap-1.5">
                {draft.bodyMode === "json" && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        try {
                          const formatted = JSON.stringify(JSON.parse(draft.bodyText), null, 2);
                          onChange({ bodyText: formatted });
                        } catch {}
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-mono text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
                    >
                      Prettify
                    </button>
                  </div>
                )}
                <CodeEditor
                  value={draft.bodyText}
                  onChange={(v) => onChange({ bodyText: v })}
                  placeholder={draft.bodyMode === "json" ? '{\n  "key": "value",\n  "token": "{{token}}"\n}' : "raw text body"}
                  variables={variableNames}
                  className="h-40 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
                />
              </div>
            )}
          </div>
        )}
        {reqTab === "scripts" && (
          <div className="flex gap-3 flex-1 min-h-0">
            <div className="w-[130px] shrink-0 flex flex-col gap-0.5">
              {(
                [
                  ["pre", "Pre-request", draft.preScript],
                  ["post", "Post-response", draft.testScript],
                ] as const
              ).map(([key, label, script]) => (
                <button
                  key={key}
                  onClick={() => setScriptTab(key)}
                  className={`px-2.5 py-1.5 rounded-md text-[12.5px] text-left flex items-center justify-between gap-1.5 transition-colors ${
                    scriptTab === key ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-2 hover:text-th-text-1 hover:bg-th-hover"
                  }`}
                >
                  {label}
                  {script.trim() && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-1.5">
              {scriptTab === "pre" ? (
                <>
                  <CodeEditor
                    value={draft.preScript}
                    onChange={(v) => onChange({ preScript: v })}
                    placeholder={PRE_PLACEHOLDER}
                    completions={PM_PRE_COMPLETIONS}
                    variables={variableNames}
                    className="flex-1 min-h-0 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
                  />
                  <span className="text-[11px] text-th-text-4 font-mono shrink-0">runs before send · pm.environment, pm.variables, pm.request, crypto (CryptoJS), require("crypto-js")</span>
                </>
              ) : (
                <>
                  <CodeEditor
                    value={draft.testScript}
                    onChange={(v) => onChange({ testScript: v })}
                    placeholder={TEST_PLACEHOLDER}
                    completions={PM_TEST_COMPLETIONS}
                    variables={variableNames}
                    className="flex-1 min-h-0 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
                  />
                  <span className="text-[11px] text-th-text-4 font-mono shrink-0">runs after response · pm.test, pm.expect, pm.response</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showSnippet && <CodeSnippetModal draft={draft} onClose={() => setShowSnippet(false)} />}
    </div>
  );
}
