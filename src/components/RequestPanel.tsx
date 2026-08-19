import React, { useEffect, useMemo, useRef, useState } from "react";
import { Method, RequestData, Example, KVRow, uid, buildUrlFromParams, parseQueryToRows, parsePathParamsFromUrl } from "../types";
import { mergedVariables, runTestScriptAgainstExample } from "../lib/useSendRequest";
import KeyValueEditor, { ValueInput } from "./KeyValueEditor";
import FormDataEditor from "./FormDataEditor";
import CodeEditor from "./CodeEditor";
import CodeSnippetModal from "./CodeSnippetModal";
import { PM_PRE_COMPLETIONS, PM_TEST_COMPLETIONS } from "../lib/pmCompletions";
import { useWorkspace } from "../store";
import { useVariableMenu, VariableGroup } from "../lib/useVariableMenu";
import VariableMenuList from "./VariableMenuList";
import AnchorPortal from "./AnchorPortal";
import SimpleSelect from "./SimpleSelect";
import ApiHistoryPanel from "./ApiHistoryPanel";
import ContractCheckModal from "./ContractCheckModal";
import { highlightUrlTokens } from "../lib/urlHighlight";
import { renderMarkdown } from "../lib/markdown";

function UrlInput({ value, onChange, onKeyDown, placeholder, variables }: {
  value: string;
  onChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  variables?: VariableGroup[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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
    <div ref={wrapRef} className="flex-1 min-w-0 relative">
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
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(menu.items[menu.activeIndex].name); return; }
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
        <AnchorPortal anchorRef={wrapRef}>
          <VariableMenuList
            items={menu.items}
            activeIndex={menu.activeIndex}
            onHover={hover}
            onSelect={select}
            style={{ top: "100%", left: `${menu.col}ch`, marginTop: "4px" }}
          />
        </AnchorPortal>
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
  if (draft.bodyMode === "form-data" && !userHas("content-type")) rows.push(["Content-Type", "multipart/form-data; boundary=<calculated when request is sent>"]);
  if (draft.bodyMode === "urlencoded" && !userHas("content-type")) rows.push(["Content-Type", "application/x-www-form-urlencoded"]);
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

function statusColor(status: number): string {
  if (status >= 500) return "text-rose-400 bg-rose-400/10 ring-rose-400/30";
  if (status >= 400) return "text-amber-400 bg-amber-400/10 ring-amber-400/30";
  return "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30";
}

// Same algorithm as Rust's slugify() in mock_server.rs — an example's
// scenario key defaults to its (slugified) name, but scenarioKey overrides
// that independently so the display name can stay descriptive while the
// header value stays short. Either way this keeps the hint in sync with
// what the server actually accepts in the X-Mock-Scenario header.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Saved response snapshots the local mock server serves back for this
// request (see mock_server.rs) — the default one is served with no header
// needed; the others are picked via `X-Mock-Scenario: <slug of their name>`.
interface ExamplesTabProps {
  examples: Example[];
  onChange: (examples: Example[]) => void;
  testScript: string;
  variables: KVRow[];
  mockPort: number | null;
  onCompareVsMock: () => void;
}

function ExamplesTab({ examples, onChange, testScript, variables, mockPort, onCompareVsMock }: ExamplesTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [testRunResults, setTestRunResults] = useState<Record<string, { passed: number; total: number }> | null>(null);

  const addBlank = () => {
    const created: Example = {
      id: uid(),
      name: "New Example",
      status: 200,
      headers: [],
      body: "{}",
      isDefault: examples.length === 0,
    };
    onChange([...examples, created]);
    setRenamingId(created.id);
    setExpandedId(created.id);
  };

  // Runs testScript against every saved example's status/body locally (no
  // network, no mock server needed) — catches "the 404 scenario doesn't
  // actually satisfy my assertions" before ever wiring it into the mock.
  const runAllTests = () => {
    const results: Record<string, { passed: number; total: number }> = {};
    for (const ex of examples) {
      const testResults = runTestScriptAgainstExample(testScript, variables, ex);
      results[ex.id] = { passed: testResults.filter((t) => t.passed).length, total: testResults.length };
    }
    setTestRunResults(results);
  };

  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={addBlank}
        className="shrink-0 px-2.5 py-1.5 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-accent-text hover:bg-th-hover transition-colors"
      >
        + New example
      </button>
      <button
        onClick={runAllTests}
        disabled={!testScript.trim() || examples.length === 0}
        title={
          !testScript.trim()
            ? "Write a testScript in the Scripts tab first"
            : examples.length === 0
            ? "Save at least one example first"
            : "Run this request's testScript against every saved example's status/body — no network, no mock server needed"
        }
        className="shrink-0 px-2.5 py-1.5 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-accent-text hover:bg-th-hover transition-colors disabled:opacity-40 disabled:hover:text-th-text-2 disabled:hover:bg-transparent disabled:cursor-default"
      >
        Run all tests
      </button>
      <button
        onClick={onCompareVsMock}
        disabled={!mockPort}
        title={!mockPort ? "Start the local mock server first" : "Send this request to the mock server and to your active environment, then diff the results"}
        className="shrink-0 px-2.5 py-1.5 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-accent-text hover:bg-th-hover transition-colors disabled:opacity-40 disabled:hover:text-th-text-2 disabled:hover:bg-transparent disabled:cursor-default"
      >
        Compare vs Mock
      </button>
    </div>
  );

  if (examples.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-4">
        <div className="max-w-[360px]">
          <p className="text-[13px] text-th-text-2 font-medium mb-1">No examples yet</p>
          <p className="text-[12px] text-th-text-4">
            Send this request and use "Save as example" in the response panel below, or write one from scratch. The default example is what the mock server replies with; save more to pick between them with an <code className="text-th-accent-text">X-Mock-Scenario</code> header.
          </p>
        </div>
        {toolbar}
      </div>
    );
  }

  const setDefault = (id: string) => {
    onChange(examples.map((e) => ({ ...e, isDefault: e.id === id })));
  };
  const remove = (id: string) => {
    const next = examples.filter((e) => e.id !== id);
    if (next.length && !next.some((e) => e.isDefault)) next[0].isDefault = true;
    onChange(next);
  };
  const rename = (id: string, name: string) => {
    onChange(examples.map((e) => (e.id === id ? { ...e, name } : e)));
  };
  const setStatus = (id: string, status: number) => {
    onChange(examples.map((e) => (e.id === id ? { ...e, status } : e)));
  };
  const setBody = (id: string, body: string) => {
    onChange(examples.map((e) => (e.id === id ? { ...e, body } : e)));
  };
  const setScenarioKey = (id: string, scenarioKey: string) => {
    onChange(examples.map((e) => (e.id === id ? { ...e, scenarioKey: scenarioKey.trim() || undefined } : e)));
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
      {toolbar}
      {examples.map((ex) => (
        <div key={ex.id} className="border border-th-border rounded-md bg-th-surface">
          <div className="flex items-center gap-2 px-3 py-2">
            {editingStatusId === ex.id ? (
              <input
                autoFocus
                type="number"
                min={100}
                max={599}
                defaultValue={ex.status}
                onBlur={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setStatus(ex.id, Number.isFinite(n) ? Math.min(599, Math.max(100, n)) : ex.status);
                  setEditingStatusId(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="w-14 shrink-0 bg-th-bg border border-th-border-focus rounded px-1 py-0.5 text-[11px] font-mono text-th-text-1"
              />
            ) : (
              <button
                onClick={() => setEditingStatusId(ex.id)}
                title="Edit status code"
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold ring-1 shrink-0 hover:brightness-125 ${statusColor(ex.status)}`}
              >
                {ex.status}
              </button>
            )}
            {renamingId === ex.id ? (
              <input
                autoFocus
                defaultValue={ex.name}
                onBlur={(e) => {
                  rename(ex.id, e.target.value.trim() || ex.name);
                  setRenamingId(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="flex-1 min-w-0 bg-th-bg border border-th-border-focus rounded px-1.5 py-0.5 text-[12.5px] font-mono text-th-text-1"
              />
            ) : (
              <button
                onClick={() => setRenamingId(ex.id)}
                title="Rename"
                className="flex-1 min-w-0 text-left truncate text-[12.5px] font-mono text-th-text-1 hover:text-th-accent-text"
              >
                {ex.name}
              </button>
            )}
            <button
              onClick={() => setDefault(ex.id)}
              title={ex.isDefault ? "Served by the local mock server" : "Set as the mock server's response"}
              className={`shrink-0 text-[10.5px] font-mono px-1.5 py-0.5 rounded-full ring-1 ${
                ex.isDefault ? "text-th-accent-text bg-th-accent-bg ring-th-accent-border" : "text-th-text-4 ring-th-border hover:text-th-text-2"
              }`}
            >
              {ex.isDefault ? "★ mock" : "set as mock"}
            </button>
            {testRunResults?.[ex.id] && (
              <span
                title="Result of this request's testScript run against this example's status/body"
                className={`shrink-0 text-[10.5px] font-mono px-1.5 py-0.5 rounded-full ring-1 ${
                  testRunResults[ex.id].total === 0
                    ? "text-th-text-4 ring-th-border"
                    : testRunResults[ex.id].passed === testRunResults[ex.id].total
                    ? "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30"
                    : "text-rose-400 bg-rose-400/10 ring-rose-400/30"
                }`}
              >
                {testRunResults[ex.id].total === 0 ? "no tests" : `${testRunResults[ex.id].passed}/${testRunResults[ex.id].total}`}
              </span>
            )}
            <button
              onClick={() => setExpandedId(expandedId === ex.id ? null : ex.id)}
              title="Toggle body preview"
              className="shrink-0 text-th-text-3 hover:text-th-text-1 w-6 h-6 grid place-items-center rounded hover:bg-th-hover"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={expandedId === ex.id ? "rotate-180" : ""}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              onClick={() => remove(ex.id)}
              title="Delete example"
              className="shrink-0 text-th-text-3 hover:text-rose-400 w-6 h-6 grid place-items-center rounded hover:bg-th-hover"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
          {!ex.isDefault && (
            <p className="px-3 pb-2 -mt-1 text-[11px] font-mono text-th-text-4 flex items-center gap-1 flex-wrap">
              <span>X-Mock-Scenario:</span>
              {editingKeyId === ex.id ? (
                <input
                  autoFocus
                  defaultValue={ex.scenarioKey ?? slugify(ex.name)}
                  onBlur={(e) => {
                    setScenarioKey(ex.id, slugify(e.target.value));
                    setEditingKeyId(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="bg-th-bg border border-th-border-focus rounded px-1 py-0.5 text-[11px] font-mono text-th-accent-text"
                />
              ) : (
                <button onClick={() => setEditingKeyId(ex.id)} title="Edit scenario key" className="text-th-accent-text hover:underline">
                  {ex.scenarioKey ?? slugify(ex.name)}
                </button>
              )}
              <span>to get this response from the mock server</span>
            </p>
          )}
          {expandedId === ex.id && (
            <div className="mx-3 mb-2.5 flex flex-col gap-1.5">
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    try {
                      setBody(ex.id, JSON.stringify(JSON.parse(ex.body), null, 2));
                    } catch {}
                  }}
                  className="px-2 py-0.5 rounded text-[11px] font-mono text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
                >
                  Prettify
                </button>
              </div>
              <CodeEditor
                value={ex.body}
                onChange={(v) => setBody(ex.id, v)}
                placeholder='{\n  "key": "value"\n}'
                className="h-40 bg-th-bg border border-th-border-input rounded-md focus-within:border-th-border-focus"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  nodeId: string;
  draft: RequestData;
  loading: boolean;
  dirty: boolean;
  onChange: (patch: Partial<RequestData>) => void;
  onSend: () => void;
  onSave: () => void;
}

export default function RequestPanel({ nodeId, draft, loading, dirty, onChange, onSend, onSave }: Props) {
  const [reqTab, setReqTab] = useState<"docs" | "params" | "auth" | "headers" | "body" | "examples" | "scripts" | "history">("params");
  const [docsMode, setDocsMode] = useState<"edit" | "preview">("edit");
  const [scriptTab, setScriptTab] = useState<"pre" | "post">("pre");
  const [showSnippet, setShowSnippet] = useState(false);
  const methodColor = METHOD_COLOR[draft.method] || METHOD_COLOR.GET;

  const { workspace, mockServerRunningPort } = useWorkspace();
  const [showContractCheck, setShowContractCheck] = useState(false);
  // Grouped by scope so the {{variable}} completion menu can show where each
  // suggestion comes from — "Global" (workspace-level) plus one group per
  // environment (named after it, e.g. "Local", "Staging"), regardless of
  // which environment is currently active.
  const variableGroups = useMemo(() => {
    const groups: VariableGroup[] = [];
    const globalNames = workspace.variables.filter((v) => v.key.trim()).map((v) => v.key);
    if (globalNames.length) groups.push({ category: "Global", names: globalNames });
    for (const env of workspace.environments) {
      const names = env.variables.filter((v) => v.key.trim()).map((v) => v.key);
      if (names.length) groups.push({ category: env.name, names });
    }
    return groups;
  }, [workspace.variables, workspace.environments]);

  const variables = useMemo(() => mergedVariables(workspace), [workspace]);

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
  const hasBody =
    draft.bodyMode === "json" || draft.bodyMode === "text"
      ? draft.bodyText.trim().length > 0
      : draft.bodyMode === "form-data"
      ? draft.bodyForm.some((f) => f.enabled && f.key.trim())
      : draft.bodyMode === "urlencoded"
      ? draft.bodyUrlencoded.some((r) => r.enabled && r.key.trim())
      : false;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 flex items-center gap-2">
        <MethodDropdown value={draft.method} onChange={(m) => onChange({ method: m })} />
        <UrlInput
          value={draft.url}
          onChange={handleUrlChange}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="https://api.example.com/endpoint?key=value"
          variables={variableGroups}
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
            ["docs", "Docs"],
            ["params", `Params${enabledParams ? ` (${enabledParams})` : ""}`],
            ["auth", "Auth"],
            ["headers", `Headers${enabledHeaders ? ` (${enabledHeaders})` : ""}`],
            ["body", "Body"],
            ["examples", `Examples${draft.examples.length ? ` (${draft.examples.length})` : ""}`],
            ["scripts", "Scripts"],
            ["history", "History"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setReqTab(key as any)}
              className={`pb-2 -mb-px border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                reqTab === key ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"
              }`}
            >
              {label}
              {key === "docs" && draft.description.trim() && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "auth" && draft.auth.type !== "none" && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "body" && hasBody && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "scripts" && (draft.preScript.trim() || draft.testScript.trim()) && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "examples" && draft.examples.length > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 flex-1 min-h-0 flex flex-col">
        {reqTab === "docs" && (
          <div className="flex flex-col flex-1 min-h-0 gap-1.5">
            <div className="flex items-center gap-1 shrink-0">
              {(["edit", "preview"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDocsMode(m)}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-mono capitalize ring-1 transition-colors ${
                    docsMode === m ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {docsMode === "edit" ? (
              <textarea
                value={draft.description}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="Describe what this request does, its parameters, and anything else teammates should know… (Markdown supported)"
                className="flex-1 min-h-0 resize-none bg-th-surface border border-th-border-input rounded-md px-3 py-2.5 text-[13px] font-sans leading-relaxed text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto bg-th-surface border border-th-border-input rounded-md px-4 py-3">
                {draft.description.trim() ? (
                  <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.description) }} />
                ) : (
                  <span className="text-[13px] text-th-text-4">Nothing here yet — switch to Edit to write a description.</span>
                )}
              </div>
            )}
          </div>
        )}
        {reqTab === "params" && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Query Params</p>
              <KeyValueEditor rows={draft.params} onChangeRows={handleParamsChange} placeholderKey="param" placeholderVal="value" variables={variableGroups} />
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
                        variables={variableGroups}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {reqTab === "auth" && (
          <div className="flex flex-col gap-3 max-w-md">
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Type</p>
              <SimpleSelect
                value={draft.auth.type}
                onChange={(type) => onChange({ auth: { ...draft.auth, type } })}
                options={[
                  { value: "none", label: "No Auth" },
                  { value: "bearer", label: "Bearer Token" },
                  { value: "basic", label: "Basic Auth" },
                ]}
              />
            </div>
            {draft.auth.type === "bearer" && (
              <div>
                <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Token</p>
                <ValueInput
                  value={draft.auth.bearer?.token ?? ""}
                  onChange={(v) => onChange({ auth: { type: "bearer", bearer: { token: v } } })}
                  placeholder="{{token}}"
                  variables={variableGroups}
                />
              </div>
            )}
            {draft.auth.type === "basic" && (
              <>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Username</p>
                  <ValueInput
                    value={draft.auth.basic?.username ?? ""}
                    onChange={(v) =>
                      onChange({ auth: { type: "basic", basic: { username: v, password: draft.auth.basic?.password ?? "" } } })
                    }
                    placeholder="username"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Password</p>
                  <ValueInput
                    value={draft.auth.basic?.password ?? ""}
                    onChange={(v) =>
                      onChange({ auth: { type: "basic", basic: { username: draft.auth.basic?.username ?? "", password: v } } })
                    }
                    placeholder="password"
                    variables={variableGroups}
                  />
                </div>
              </>
            )}
            {draft.auth.type !== "none" && (
              <p className="text-[11.5px] text-th-text-4">
                Sets the <span className="font-mono">Authorization</span> header at send time — the row in the Headers tab is locked while this is active.
              </p>
            )}
          </div>
        )}
        {reqTab === "headers" && (
          <>
            <AutoHeadersList draft={draft} />
            <KeyValueEditor
              rows={draft.headers}
              onChangeRows={(rows) => onChange({ headers: rows })}
              placeholderKey="header"
              placeholderVal="value"
              variables={variableGroups}
              lockedKeys={draft.auth.type !== "none" ? ["authorization"] : undefined}
            />
          </>
        )}
        {reqTab === "body" && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              {(["none", "json", "text", "form-data", "urlencoded"] as const).map((m) => (
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
            {draft.bodyMode === "form-data" && (
              <FormDataEditor rows={draft.bodyForm} onChangeRows={(bodyForm) => onChange({ bodyForm })} variables={variableGroups} />
            )}
            {draft.bodyMode === "urlencoded" && (
              <KeyValueEditor
                rows={draft.bodyUrlencoded}
                onChangeRows={(bodyUrlencoded) => onChange({ bodyUrlencoded })}
                placeholderKey="key"
                placeholderVal="value"
                variables={variableGroups}
              />
            )}
            {draft.bodyMode !== "none" && draft.bodyMode !== "form-data" && draft.bodyMode !== "urlencoded" && (
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
                  variables={variableGroups}
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
                    variables={variableGroups}
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
                    variables={variableGroups}
                    className="flex-1 min-h-0 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
                  />
                  <span className="text-[11px] text-th-text-4 font-mono shrink-0">runs after response · pm.test, pm.expect, pm.response</span>
                </>
              )}
            </div>
          </div>
        )}
        {reqTab === "examples" && (
          <ExamplesTab
            examples={draft.examples}
            onChange={(examples) => onChange({ examples })}
            testScript={draft.testScript}
            variables={variables}
            mockPort={mockServerRunningPort}
            onCompareVsMock={() => setShowContractCheck(true)}
          />
        )}
        {reqTab === "history" && <ApiHistoryPanel nodeId={nodeId} />}
      </div>

      {showSnippet && <CodeSnippetModal draft={draft} onClose={() => setShowSnippet(false)} />}
      {showContractCheck && mockServerRunningPort && (
        <ContractCheckModal draft={draft} mockPort={mockServerRunningPort} onClose={() => setShowContractCheck(false)} />
      )}
    </div>
  );
}
