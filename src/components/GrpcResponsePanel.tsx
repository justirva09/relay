import React, { useState } from "react";
import { GrpcLogEntry, GrpcResponseSummary } from "../types";
import CodeView from "./CodeView";
import GrpcResponseLog from "./GrpcResponseLog";

function bytesToSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StructuredResponse({ response }: { response: GrpcResponseSummary }) {
  const [tab, setTab] = useState<"body" | "metadata">("body");
  const tabs: { key: typeof tab; label: string }[] = [
    { key: "body", label: "Body" },
    { key: "metadata", label: `Metadata (${response.metadata.length})` },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 flex items-center gap-3 text-[12.5px] font-mono shrink-0">
        {response.error ? (
          <>
            <span className="px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 text-rose-400 bg-rose-400/10 ring-rose-400/30">ERROR</span>
            <span className="text-th-text-2">gRPC call failed</span>
          </>
        ) : (
          <>
            <span className="px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 text-emerald-400 bg-emerald-400/10 ring-emerald-400/30">OK</span>
            {response.durationMs !== null && <span className="text-th-text-2">{response.durationMs}ms</span>}
            <span className="text-th-text-4">·</span>
            <span className="text-th-text-2">{bytesToSize(response.sizeBytes)}</span>
          </>
        )}
      </div>

      {!response.error && (
        <div className="px-4 mt-1">
          <div className="flex items-center gap-4 border-b border-th-border text-[12.5px] font-mono">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`pb-2 -mb-px border-b-2 transition-colors ${
                  tab === t.key ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
        {response.error ? (
          <div className="flex flex-col items-center justify-center py-10 gap-5">
            <div className="w-14 h-14 rounded-full bg-rose-500/10 ring-1 ring-rose-500/20 grid place-items-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-rose-400">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="bg-rose-500/10 ring-1 ring-rose-500/20 rounded-lg px-4 py-2.5 max-w-[460px]">
              <p className="text-[12.5px] font-mono text-rose-300 leading-relaxed">{response.error}</p>
            </div>
          </div>
        ) : tab === "body" ? (
          response.body ? (
            <CodeView value={response.body} className="-mx-4 -my-3" />
          ) : (
            <span className="text-th-text-4 text-[12.5px] font-mono">(empty body)</span>
          )
        ) : (
          <div className="flex flex-col gap-1">
            {response.metadata.map(([k, v]) => (
              <div key={k} className="text-[12.5px] font-mono flex gap-2">
                <span className="text-th-accent-text shrink-0">{k}:</span>
                <span className="text-th-text-2 break-all">{v}</span>
              </div>
            ))}
            {response.metadata.length === 0 && <span className="text-th-text-4 text-[12.5px] font-mono">no metadata</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GrpcResponsePanel({ log, streaming, lastResponse }: {
  log: GrpcLogEntry[];
  streaming: boolean;
  lastResponse: GrpcResponseSummary | null;
}) {
  const [mode, setMode] = useState<"response" | "log">("response");

  if (log.length === 0 && !streaming) {
    return (
      <div className="h-full grid place-items-center text-th-text-4 text-[13px] font-mono">
        response will appear here
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-2.5 flex gap-1.5 shrink-0">
        {(["response", "log"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-2.5 py-1 rounded-md text-[12px] font-mono ring-1 transition-colors ${
              mode === m ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
            }`}
          >
            {m === "response" ? "Response" : "Log"}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {mode === "response" && lastResponse ? (
          <StructuredResponse response={lastResponse} />
        ) : mode === "response" ? (
          <div className="h-full grid place-items-center text-th-text-4 text-[13px] font-mono">
            {streaming ? "streaming…" : "no structured response for this call — check Log"}
          </div>
        ) : (
          <GrpcResponseLog log={log} streaming={streaming} />
        )}
      </div>
    </div>
  );
}
