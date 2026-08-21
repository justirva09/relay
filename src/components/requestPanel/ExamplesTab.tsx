import { useState } from "react";
import { Example, KVRow, newRow, uid } from "../../types";
import { runTestScriptAgainstExample } from "../../lib/useSendRequest";
import CodeEditor from "../CodeEditor";
import KeyValueEditor from "../KeyValueEditor";
import { COMMON_HTTP_HEADERS } from "../../lib/httpHeaders";

// Example.headers is a plain tuple array (matches ResponseState), the
// editor wants KVRow[], so convert at the boundary instead of changing
// Example's shape.
function headersToRows(headers: [string, string][]): KVRow[] {
  const rows = headers.map(([key, value]) => ({ ...newRow(), key, value }));
  return rows.length ? rows : [newRow()];
}

function rowsToHeaders(rows: KVRow[]): [string, string][] {
  return rows.filter((r) => r.enabled && r.key.trim()).map((r) => [r.key.trim(), r.value] as [string, string]);
}

function statusColor(status: number): string {
  if (status >= 500) return "text-rose-400 bg-rose-400/10 ring-rose-400/30";
  if (status >= 400) return "text-amber-400 bg-amber-400/10 ring-amber-400/30";
  return "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30";
}

// must match Rust's slugify() in mock_server.rs, scenarioKey can override
// the default so the display name stays readable while the header stays short
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// saved response snapshots the mock server serves for this request, default
// one needs no header, others are picked via X-Mock-Scenario
interface ExamplesTabProps {
  examples: Example[];
  onChange: (examples: Example[]) => void;
  testScript: string;
  variables: KVRow[];
  safeMode: boolean;
  mockPort: number | null;
  onCompareVsMock: () => void;
  contractCheckEntitled: boolean;
}

export default function ExamplesTab({ examples, onChange, testScript, variables, safeMode, mockPort, onCompareVsMock, contractCheckEntitled }: ExamplesTabProps) {
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

  // runs testScript against every saved example locally, no network needed
  const runAllTests = async () => {
    const entries = await Promise.all(
      examples.map(async (ex) => {
        const testResults = await runTestScriptAgainstExample(testScript, variables, ex, safeMode);
        return [ex.id, { passed: testResults.filter((t) => t.passed).length, total: testResults.length }] as const;
      })
    );
    setTestRunResults(Object.fromEntries(entries));
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
        title={
          !mockPort
            ? "Start the local mock server first"
            : contractCheckEntitled
            ? "Send this request to the mock server and to your active environment, then diff the results"
            : "Requires Relay Pro — click to check your account"
        }
        className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-accent-text hover:bg-th-hover transition-colors disabled:opacity-40 disabled:hover:text-th-text-2 disabled:hover:bg-transparent disabled:cursor-default"
      >
        Compare vs Mock
        {!contractCheckEntitled && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-th-text-4">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
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
  const setHeaderRows = (id: string, rows: KVRow[]) => {
    onChange(examples.map((e) => (e.id === id ? { ...e, headers: rowsToHeaders(rows) } : e)));
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
                className="h-64 bg-th-bg border border-th-border-input rounded-md focus-within:border-th-border-focus"
              />
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mt-1">Response Headers</p>
              <KeyValueEditor
                rows={headersToRows(ex.headers)}
                onChangeRows={(rows) => setHeaderRows(ex.id, rows)}
                placeholderKey="header"
                placeholderVal="value"
                showToggle
                keySuggestions={COMMON_HTTP_HEADERS}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
