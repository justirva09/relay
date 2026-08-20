import React, { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../store";
import { flattenRequests, filterByTags, parseDataFile, runCollection, generateHtmlReport, buildReportData, RunnerResult } from "../lib/runner";
import { mergedVariables } from "../lib/useSendRequest";
import { hasFeature, subscribeLicense } from "../lib/license";
import { runAction } from "../lib/keybindings";
import { pickAnyFile, readFileAtPath, pickSavePath, writeFileAtPath } from "../lib/tauri";
import ToggleSwitch from "./ToggleSwitch";
import CodeView from "./CodeView";
import { isJson } from "./JsonTree";
import InfoTooltip from "./InfoTooltip";

const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-rose-400",
  HEAD: "text-th-text-3",
  OPTIONS: "text-th-text-3",
};

function MethodChip({ method }: { method: string }) {
  return <span className={`font-mono text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-th-surface ${METHOD_COLOR[method] || "text-th-text-3"}`}>{method}</span>;
}

function bytesToSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ResultDetail({ result }: { result: RunnerResult }) {
  const [tab, setTab] = useState<"body" | "headers" | "tests">("body");
  const { response } = result;
  const testsTotal = response.testResults.length;
  const testsPassed = response.testResults.filter((t) => t.passed).length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-3 border-b border-th-border flex items-center gap-3 shrink-0">
        <MethodChip method={result.method} />
        <span className="text-[13px] font-mono text-th-text-1 truncate flex-1 min-w-0">{result.name}</span>
        {response.error ? (
          <span className="ml-auto px-2 py-0.5 rounded text-[11.5px] font-mono font-semibold ring-1 text-rose-400 bg-rose-400/10 ring-rose-400/30">ERROR</span>
        ) : (
          <span className="ml-auto flex items-center gap-2 text-[12px] font-mono text-th-text-3">
            <span className={response.ok ? "text-emerald-400" : "text-rose-400"}>{response.status}</span>
            {response.time}ms · {bytesToSize(response.size)}
          </span>
        )}
      </div>
      <div className="px-5 pt-2 flex items-center gap-4 border-b border-th-border text-[12px] font-mono shrink-0">
        {(["body", "headers", "tests"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 -mb-px border-b-2 capitalize transition-colors ${tab === t ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"}`}
          >
            {t === "tests" ? `Tests${testsTotal ? ` (${testsPassed}/${testsTotal})` : ""}` : t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {tab === "body" &&
          (response.error ? (
            <p className="text-[12.5px] font-mono text-rose-300">{response.error}</p>
          ) : response.body ? (
            isJson(response.body) ? (
              <CodeView value={JSON.stringify(JSON.parse(response.body), null, 2)} className="-mx-5 -my-3" />
            ) : (
              <pre className="text-[12.5px] font-mono text-th-text-1 whitespace-pre-wrap break-words leading-[1.6]">{response.body}</pre>
            )
          ) : (
            <span className="text-th-text-4 text-[12.5px] font-mono">(empty body)</span>
          ))}
        {tab === "headers" && (
          response.headers.length > 0 ? (
            <div className="-mx-5 -my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px] font-mono">
                <thead>
                  <tr className="border-b border-th-border">
                    <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-5 py-2 w-[38%]">Name</th>
                    <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-5 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {response.headers.map(([k, v], i) => (
                    <tr key={`${k}-${i}`} className="border-b border-th-border last:border-0 hover:bg-th-hover">
                      <td className="align-top px-5 py-1.5 text-th-accent-text">{k}</td>
                      <td className="align-top px-5 py-1.5 text-th-text-2 break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <span className="text-th-text-4 text-[12.5px] font-mono">no headers</span>
          )
        )}
        {tab === "tests" && (
          <div className="flex flex-col gap-1.5">
            {response.testResults.map((t, i) => (
              <div key={i} className="text-[12.5px] font-mono">
                <div className={`flex items-center gap-2 ${t.passed ? "text-emerald-400" : "text-rose-400"}`}>
                  <span>{t.passed ? "✓" : "✗"}</span>
                  <span>{t.name}</span>
                </div>
                {!t.passed && t.error && <div className="pl-5 text-rose-400/70">{t.error}</div>}
              </div>
            ))}
            {response.testResults.length === 0 && <span className="text-th-text-4 text-[12.5px] font-mono">no tests on this request</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RunnerPanel({ onClose }: { onClose: () => void }) {
  const { workspace, safeMode, cookies, setCookies, applyVariableChanges } = useWorkspace();
  const allItems = useMemo(() => flattenRequests(workspace.tree), [workspace.tree]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(allItems.map((i) => i.id)));
  const [delayMs, setDelayMs] = useState(0);
  const [includeTags, setIncludeTags] = useState("");
  const [excludeTags, setExcludeTags] = useState("");
  const [iterations, setIterations] = useState(1);
  const [parallel, setParallel] = useState(false);
  const [dataRows, setDataRows] = useState<Record<string, string>[] | null>(null);
  const [dataFileName, setDataFileName] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  const [, forceLicenseRerender] = useState(0);
  useEffect(() => subscribeLicense(() => forceLicenseRerender((n) => n + 1)), []);
  const dataDrivenEntitled = hasFeature("runner.dataDriven");

  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"config" | "results">("config");
  const [results, setResults] = useState<RunnerResult[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<"all" | "passed" | "failed">("all");
  const [selectedResultKey, setSelectedResultKey] = useState<string | null>(null);
  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const reportMenuRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const htmlReportEntitled = hasFeature("report.html");

  useEffect(() => {
    if (!reportMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (reportMenuRef.current && !reportMenuRef.current.contains(e.target as Node)) setReportMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [reportMenuOpen]);

  const includeTagList = includeTags.split(",").map((s) => s.trim()).filter(Boolean);
  const excludeTagList = excludeTags.split(",").map((s) => s.trim()).filter(Boolean);
  const filteredItems = useMemo(() => filterByTags(allItems, includeTagList, excludeTagList), [allItems, includeTags, excludeTags]);
  const selectedItems = filteredItems.filter((i) => selected.has(i.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(filteredItems.map((i) => i.id)));
  const deselectAll = () => setSelected(new Set());

  const pickDataFile = async () => {
    const path = await pickAnyFile();
    if (!path) return;
    setDataError(null);
    try {
      const content = await readFileAtPath(path);
      const rows = parseDataFile(content, path.toLowerCase().endsWith(".json"));
      setDataRows(rows);
      setDataFileName(path.split(/[\\/]/).pop() ?? path);
    } catch (e: any) {
      setDataError(e?.message ?? String(e));
      setDataRows(null);
      setDataFileName(null);
    }
  };

  const downloadDataTemplate = async () => {
    const tokens = new Set<string>();
    for (const item of selectedItems.length > 0 ? selectedItems : filteredItems) {
      const matches = JSON.stringify(item.request).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g);
      for (const m of matches) tokens.add(m[1]);
    }
    const columns = tokens.size > 0 ? Array.from(tokens) : ["email", "password", "expectedStatus"];
    const csv = [columns.join(","), columns.map(() => "value").join(",")].join("\n");
    const path = await pickSavePath("relay-runner-template.csv", "CSV", ["csv"]);
    if (!path) return;
    await writeFileAtPath(path, csv);
  };

  const start = async () => {
    if (selectedItems.length === 0) return;
    setRunning(true);
    setView("results");
    setResults([]);
    setSelectedResultKey(null);
    setRunStartedAt(new Date().toISOString());
    cancelledRef.current = false;
    try {
      await runCollection(
        selectedItems,
        mergedVariables(workspace),
        applyVariableChanges,
        cookies,
        setCookies,
        safeMode,
        { delayMs, iterations, parallel, dataRows: dataDrivenEntitled && dataRows ? dataRows : undefined },
        (result) => setResults((prev) => [...prev, result]),
        () => cancelledRef.current
      );
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    cancelledRef.current = true;
  };
  const reset = () => {
    setResults([]);
    setSelectedResultKey(null);
    setView("config");
  };

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const filteredResults = results.filter((r) => resultFilter === "all" || r.status === resultFilter);
  const selectedResult = results.find((r) => r.key === selectedResultKey) ?? null;

  const environmentName = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId)?.name ?? null;

  const downloadReport = async (format: "json" | "html") => {
    if (format === "html" && !hasFeature("report.html")) {
      runAction("view.settings");
      return;
    }
    const meta = { environment: environmentName, runStartedAt, tagFilter: { include: includeTagList, exclude: excludeTagList } };
    if (format === "html") {
      const path = await pickSavePath("relay-runner-report.html", "HTML", ["html"]);
      if (!path) return;
      await writeFileAtPath(path, generateHtmlReport(results, meta));
      return;
    }
    const path = await pickSavePath("relay-runner-report.json", "JSON", ["json"]);
    if (!path) return;
    await writeFileAtPath(path, JSON.stringify({ environment: environmentName, runStartedAt, results: buildReportData(results) }, null, 2));
  };

  const showResults = view === "results";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-4 border-b border-th-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {showResults && (
            <button
              onClick={() => setView("config")}
              disabled={running}
              title="Back to request selection"
              className="shrink-0 h-7 w-7 grid place-items-center rounded text-th-text-3 hover:text-th-text-1 hover:bg-th-hover disabled:opacity-40"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-[16px] font-semibold text-th-text-1">Runner</h1>
            <p className="text-[12px] text-th-text-3 mt-0.5">
              Runs multiple requests in sequence — useful for smoke-testing a whole flow (e.g. login → create → verify → cleanup) without clicking Send on each one by hand.
            </p>
          </div>
        </div>
        <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover shrink-0">
          ×
        </button>
      </div>

      {!showResults ? (
        <div className="flex-1 flex min-h-0">
          <div className="w-[340px] shrink-0 border-r border-th-border overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Timings</p>
              <label className="block text-[12px] text-th-text-2 mb-1">Delay between requests (ms)</label>
              <input
                type="number"
                min={0}
                value={delayMs}
                onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
                placeholder="e.g. 100"
                className="w-full bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
              />
            </div>

            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Filters</p>
              <label className="block text-[12px] text-th-text-2 mb-1">Include tags</label>
              <input
                value={includeTags}
                onChange={(e) => setIncludeTags(e.target.value)}
                placeholder="e.g. smoke, regression"
                className="w-full bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus mb-2"
              />
              <label className="block text-[12px] text-th-text-2 mb-1">Exclude tags</label>
              <input
                value={excludeTags}
                onChange={(e) => setExcludeTags(e.target.value)}
                placeholder="e.g. slow"
                className="w-full bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
              />
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide">Run with Parameters</p>
                <InfoTooltip text="Upload a CSV or JSON file to run the selected requests once per row. Each column becomes a variable for that iteration — e.g. a column named email makes {{email}} available in the request." />
                {!dataDrivenEntitled && <span className="text-[9.5px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-th-accent-bg text-th-accent-text">Pro</span>}
              </div>
              {dataDrivenEntitled ? (
                <>
                  <button
                    onClick={pickDataFile}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
                  >
                    {dataFileName ?? "Select CSV or JSON file…"}
                  </button>
                  {dataRows && <p className="text-[11px] text-emerald-400 mt-1">{dataRows.length} row(s) loaded — runs once per row</p>}
                  {dataError && <p className="text-[11px] text-rose-400 mt-1">{dataError}</p>}
                  {dataRows && (
                    <button onClick={() => { setDataRows(null); setDataFileName(null); }} className="text-[11px] text-th-text-3 hover:text-th-text-1 mt-1">
                      Clear data file
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => runAction("view.settings")}
                  className="w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-4 hover:text-th-text-2 hover:border-th-text-4"
                >
                  Select CSV or JSON file… (Sign in to unlock)
                </button>
              )}
              <button onClick={downloadDataTemplate} className="text-[11px] text-th-text-3 hover:text-th-accent-text mt-1.5">
                Download template (CSV)
              </button>
            </div>

            {!dataRows && (
              <div>
                <label className="block text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Iterations</label>
                <input
                  type="number"
                  min={1}
                  value={iterations}
                  onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
                />
              </div>
            )}

            <ToggleSwitch checked={parallel} onChange={setParallel} label="Run in parallel" />

            <button
              onClick={start}
              disabled={selectedItems.length === 0}
              className="mt-1 px-4 py-2 rounded-md text-[13px] font-semibold bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-50 transition-colors"
            >
              Run {selectedItems.length} Request{selectedItems.length === 1 ? "" : "s"}
            </button>
            {results.length > 0 && (
              <button onClick={() => setView("results")} className="text-[12px] font-mono text-th-accent-text hover:underline text-left">
                &larr; Back to last results
              </button>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <div className="px-5 py-3 border-b border-th-border flex items-center justify-between shrink-0">
              <p className="text-[12px] font-mono text-th-text-3">
                {selected.size} of {filteredItems.length} selected
              </p>
              <div className="flex items-center gap-3 text-[12px] font-mono shrink-0">
                <button onClick={selectAll} className="text-th-accent-text hover:underline">
                  Select All
                </button>
                <button onClick={deselectAll} className="text-th-accent-text hover:underline">
                  Deselect All
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-2">
              {filteredItems.length === 0 && <p className="text-[12.5px] font-mono text-th-text-4 py-6 text-center">No requests match these tag filters.</p>}
              {filteredItems.map((item) => (
                <label key={item.id} className="flex items-center gap-2.5 py-1.5 cursor-pointer min-w-0">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} className="h-3.5 w-3.5 accent-[var(--c-accent)] shrink-0" />
                  <MethodChip method={item.method} />
                  {item.path.length > 0 && <span className="text-[11px] text-th-text-4 font-mono truncate shrink-0 max-w-[35%]">{item.path.join(" / ")} /</span>}
                  <span className="text-[13px] font-mono text-th-text-1 truncate flex-1 min-w-0">{item.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="w-[340px] shrink-0 border-r border-th-border flex flex-col min-h-0">
            <div className="px-3 py-2.5 border-b border-th-border flex items-center gap-1 shrink-0">
              <span className="text-[10.5px] font-mono text-th-text-4 mr-0.5 shrink-0">Filter:</span>
              {(["all", "passed", "failed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setResultFilter(f)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-mono capitalize flex items-center gap-0.5 shrink-0 ${
                    resultFilter === f ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:bg-th-hover"
                  }`}
                >
                  {f}
                  <span className="text-th-text-4">{f === "all" ? results.length : f === "passed" ? passed : failed}</span>
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {filteredResults.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setSelectedResultKey(r.key)}
                  className={`w-full min-w-0 flex items-center gap-2 px-4 py-2 text-left border-b border-th-border hover:bg-th-hover ${selectedResultKey === r.key ? "bg-th-hover" : ""}`}
                >
                  {r.status === "passed" ? (
                    <span className="text-emerald-400 shrink-0">✓</span>
                  ) : (
                    <span className="text-rose-400 shrink-0">✗</span>
                  )}
                  <MethodChip method={r.method} />
                  <span className="text-[12.5px] font-mono text-th-text-1 truncate flex-1 min-w-0">{r.name}</span>
                  {r.response.status != null && <span className="ml-auto text-[11px] font-mono text-th-text-3 shrink-0">{r.response.status}</span>}
                </button>
              ))}
              {running && <p className="px-4 py-3 text-[12px] font-mono text-th-text-4">Running…</p>}
            </div>
            <div className="px-4 py-3 border-t border-th-border flex flex-col gap-2 shrink-0">
              <div className="flex items-center gap-2">
                {running ? (
                  <button onClick={stop} className="flex-1 px-3 py-1.5 rounded-md text-[12px] font-mono whitespace-nowrap border border-th-border-input text-rose-400 hover:bg-rose-400/10">
                    Stop
                  </button>
                ) : (
                  <button onClick={start} className="flex-1 px-3 py-1.5 rounded-md text-[12px] font-mono whitespace-nowrap border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4">
                    Run Again
                  </button>
                )}
                <button onClick={reset} disabled={running} className="flex-1 px-3 py-1.5 rounded-md text-[12px] font-mono whitespace-nowrap border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4 disabled:opacity-40">
                  Reset
                </button>
              </div>
              <div className="relative flex" ref={reportMenuRef}>
                <button
                  onClick={() => downloadReport("json")}
                  disabled={running || results.length === 0}
                  className="flex-1 px-3 py-1.5 rounded-l-md text-[12px] font-mono whitespace-nowrap bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-40"
                >
                  Download Report
                </button>
                <button
                  onClick={() => setReportMenuOpen((o) => !o)}
                  disabled={running || results.length === 0}
                  title="Choose report format"
                  className="px-2 rounded-r-md border-l border-white/20 bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-40"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {reportMenuOpen && (
                  <div className="absolute bottom-full right-0 mb-1 w-48 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 z-20">
                    <button
                      onClick={() => {
                        setReportMenuOpen(false);
                        downloadReport("json");
                      }}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[12px] font-mono text-th-text-2 hover:bg-th-hover hover:text-th-text-1"
                    >
                      JSON
                    </button>
                    <button
                      onClick={() => {
                        setReportMenuOpen(false);
                        downloadReport("html");
                      }}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[12px] font-mono text-th-text-2 hover:bg-th-hover hover:text-th-text-1"
                    >
                      HTML
                      {!htmlReportEntitled && <span className="text-[9.5px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-th-accent-bg text-th-accent-text">Pro</span>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {selectedResult ? <ResultDetail result={selectedResult} /> : <div className="flex-1 grid place-items-center text-th-text-4 text-[12.5px] font-mono">Select a result to view its response</div>}
        </div>
      )}
    </div>
  );
}
