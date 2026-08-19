import React, { useState, useEffect } from "react";
import { ResponseState } from "../types";
import { isJson } from "./JsonTree";
import CodeView from "./CodeView";

function StatusPill({ status, ok }: { status: number | null; ok: boolean }) {
  if (status == null) return null;
  const color = ok ? "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30" : "text-rose-400 bg-rose-400/10 ring-rose-400/30";
  return <span className={`px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 ${color}`}>{status}</span>;
}

function bytesToSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ResponsePanel({
  response,
  loading,
  onSaveExample,
}: {
  response: ResponseState | null;
  loading: boolean;
  onSaveExample?: () => void;
}) {
  const [respTab, setRespTab] = useState<"body" | "headers" | "request" | "tests" | "console">("body");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (response) {
      setRespTab("body");
      setSaved(false);
    }
  }, [response]);

  const testsPassed = response?.testResults.filter((t) => t.passed).length ?? 0;
  const testsTotal = response?.testResults.length ?? 0;

  const respTabs: { key: typeof respTab; label: string }[] = [{ key: "body", label: "Body" }];
  if (response && !response.error) respTabs.push({ key: "headers", label: `Headers (${response.headers.length})` });
  if (response) respTabs.push({ key: "request", label: `Request (${response.request.headers.length})` });
  if (testsTotal > 0) respTabs.push({ key: "tests", label: `Tests (${testsPassed}/${testsTotal})` });
  if (response?.logs.length || response?.preError) respTabs.push({ key: "console", label: "Console" });

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 flex items-center gap-3 text-[12.5px] font-mono shrink-0">
        {loading ? (
          <span className="text-th-text-3">sending…</span>
        ) : response ? (
          response.error ? (
            <>
              <span className="px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 text-rose-400 bg-rose-400/10 ring-rose-400/30">ERROR</span>
              <span className="text-th-text-2">Could not send request</span>
            </>
          ) : (
            <>
              <StatusPill status={response.status} ok={response.ok} />
              <span className="text-th-text-2">{response.statusText}</span>
              <span className="text-th-text-4">·</span>
              <span className="text-th-text-2">{response.time}ms</span>
              <span className="text-th-text-4">·</span>
              <span className="text-th-text-2">{bytesToSize(response.size)}</span>
              {testsTotal > 0 && (
                <>
                  <span className="text-th-text-4">·</span>
                  <span className={testsPassed === testsTotal ? "text-emerald-400" : "text-rose-400"}>
                    {testsPassed}/{testsTotal} tests
                  </span>
                </>
              )}
            </>
          )
        ) : (
          <span className="text-th-text-4">response will appear here</span>
        )}
        {response && response.status != null && onSaveExample && (
          <button
            onClick={() => {
              onSaveExample();
              setSaved(true);
            }}
            className="ml-auto shrink-0 px-2 py-1 rounded-md text-[11.5px] font-mono border border-th-border-input text-th-text-3 hover:text-th-accent-text hover:bg-th-hover transition-colors"
          >
            {saved ? "Saved as example" : "Save as example"}
          </button>
        )}
      </div>

      <>
          {response && respTabs.length > 1 && (
            <div className="px-4 mt-1">
              <div className="flex items-center gap-4 border-b border-th-border text-[12.5px] font-mono">
                {respTabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setRespTab(t.key)}
                    className={`pb-2 -mb-px border-b-2 transition-colors ${
                      respTab === t.key ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
            {response?.error && (
              <div className="flex flex-col items-center justify-center py-10 gap-5">
                <div className="w-14 h-14 rounded-full bg-rose-500/10 ring-1 ring-rose-500/20 grid place-items-center">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-rose-400">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-[15px] font-medium text-th-text-1">Could not send request</p>
                <div className="bg-rose-500/10 ring-1 ring-rose-500/20 rounded-lg px-4 py-2.5 max-w-[460px]">
                  <p className="text-[12.5px] font-mono text-rose-300 leading-relaxed">{response.error}</p>
                </div>
              </div>
            )}

            {response && !response.error && respTab === "body" && (
              response.body ? (
                isJson(response.body) ? (
                  <CodeView value={JSON.stringify(JSON.parse(response.body), null, 2)} className="-mx-4 -my-3" />
                ) : !response.ok ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-4">
                    <div className="w-12 h-12 rounded-full bg-amber-500/10 ring-1 ring-amber-500/20 grid place-items-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-amber-400">
                        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="text-center max-w-[400px]">
                      <p className="text-[14px] font-semibold text-th-text-1 mb-2">{response.status} {response.statusText}</p>
                      <p className="text-[12.5px] font-mono text-th-text-2 leading-relaxed">{response.body}</p>
                    </div>
                  </div>
                ) : (
                  <CodeView value={response.body} className="-mx-4 -my-3" />
                )
              ) : (
                <span className="text-th-text-4 text-[12.5px] font-mono">(empty body)</span>
              )
            )}

            {response && !response.error && respTab === "headers" && (
              <div className="flex flex-col gap-1">
                {response.headers.map(([k, v]) => (
                  <div key={k} className="text-[12.5px] font-mono flex gap-2">
                    <span className="text-th-accent-text shrink-0">{k}:</span>
                    <span className="text-th-text-2 break-all">{v}</span>
                  </div>
                ))}
                {response.headers.length === 0 && <span className="text-th-text-4 text-[12.5px] font-mono">no headers</span>}
              </div>
            )}

            {response && respTab === "request" && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Sent to</p>
                  <p className="text-[12.5px] font-mono text-th-text-1 break-all">
                    <span className="text-th-accent-text">{response.request.method}</span> {response.request.url}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Headers</p>
                  <div className="flex flex-col gap-1">
                    {response.request.headers.map(([k, v], i) => (
                      <div key={`${k}-${i}`} className="text-[12.5px] font-mono flex gap-2">
                        <span className="text-th-accent-text shrink-0">{k}:</span>
                        <span className="text-th-text-2 break-all">{v}</span>
                      </div>
                    ))}
                    {response.request.headers.length === 0 && <span className="text-th-text-4 text-[12.5px] font-mono">no headers</span>}
                  </div>
                </div>
                {response.request.body !== undefined && (
                  <div>
                    <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Body</p>
                    <CodeView value={response.request.body} className="-mx-4" />
                  </div>
                )}
              </div>
            )}

            {response && respTab === "tests" && (
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
              </div>
            )}

            {response && respTab === "console" && (
              <div className="flex flex-col gap-1.5 text-[12.5px] font-mono">
                {response.preError && <div className="text-rose-400/90">Pre-request script error: {response.preError}</div>}
                {response.logs.map((l, i) => (
                  <div key={i} className="text-th-text-2">
                    {l}
                  </div>
                ))}
                {!response.preError && response.logs.length === 0 && <span className="text-th-text-4">no console output</span>}
              </div>
            )}
          </div>
        </>
    </div>
  );
}
