import React, { useEffect, useMemo, useRef, useState } from "react";
import { GrpcLogEntry, GrpcMethodType, GrpcResponseSummary } from "../../types";
import { registerAction, setActiveSearchRegion } from "../../lib/keybindings";
import { useTextHighlight } from "../../lib/useTextHighlight";
import CodeView from "../CodeView";
import GrpcResponseLog from "./GrpcResponseLog";

function bytesToSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function errorBadge(error: string): string {
  if (/deadline exceeded/i.test(error)) return "DEADLINE EXCEEDED";
  const status = /gRPC error \(([^)]+)\)/.exec(error)?.[1];
  return status ? status.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase() : "ERROR";
}

function StructuredResponse({ response }: { response: GrpcResponseSummary }) {
  const [tab, setTab] = useState<"body" | "metadata">("body");
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegexSearch, setUseRegexSearch] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const displayedBody = useMemo(() => formatBody(response.body), [response.body]);
  const tabs: { key: typeof tab; label: string }[] = [
    { key: "body", label: "Body" },
    { key: "metadata", label: `Metadata (${response.metadata.length})` },
  ];

  useEffect(() => {
    setTab("body");
    setCopied(false);
    setSearchOpen(false);
    setSearchQuery("");
  }, [response]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const searchOptions = useMemo(
    () => ({ caseSensitive, useRegex: useRegexSearch, wholeWord }),
    [caseSensitive, useRegexSearch, wholeWord]
  );
  const { matchCount, currentIndex, goNext, goPrev } = useTextHighlight(
    bodyContentRef,
    searchOpen ? searchQuery : "",
    searchOptions,
    [displayedBody]
  );

  useEffect(
    () =>
      registerAction("response.search", () => {
        if (response.error || !response.body) return;
        setTab("body");
        setSearchOpen(true);
      }),
    [response]
  );

  const handleCopy = () => {
    if (!response.body) return;
    navigator.clipboard.writeText(displayedBody).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="h-full flex flex-col relative" onMouseEnter={() => setActiveSearchRegion("response")}>
      <div className="px-4 py-2.5 flex items-center gap-3 text-[12.5px] font-mono shrink-0">
        {response.cancelled ? (
          <>
            <span className="px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 text-amber-400 bg-amber-400/10 ring-amber-400/30">CANCELLED</span>
            {response.messageCount !== undefined && (
              <span className="text-th-text-2">{response.messageCount} message{response.messageCount === 1 ? "" : "s"}</span>
            )}
            {response.durationMs !== null && <span className="text-th-text-2">{response.durationMs}ms</span>}
          </>
        ) : response.error ? (
          <>
            <span className="px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 text-rose-400 bg-rose-400/10 ring-rose-400/30">{errorBadge(response.error)}</span>
            <span className="text-th-text-2">gRPC call failed</span>
          </>
        ) : (
          <>
            <span className="px-2 py-0.5 rounded-md text-[13px] font-mono font-semibold ring-1 text-emerald-400 bg-emerald-400/10 ring-emerald-400/30">OK</span>
            {response.durationMs !== null && <span className="text-th-text-2">{response.durationMs}ms</span>}
            <span className="text-th-text-4">·</span>
            <span className="text-th-text-2">{bytesToSize(response.sizeBytes)}</span>
            {response.messageCount !== undefined && (
              <>
                <span className="text-th-text-4">·</span>
                <span className="text-th-text-2">{response.messageCount} message{response.messageCount === 1 ? "" : "s"}</span>
              </>
            )}
          </>
        )}
        {response.compression === "gzip" && (
          <span
            title="Request compression: gzip"
            className="px-1.5 py-0.5 rounded text-[10.5px] text-th-text-3 bg-th-surface ring-1 ring-th-border-input"
          >
            gzip
          </span>
        )}
      </div>

      {!response.error && (
        <div className="px-4 mt-1">
          <div className="flex items-center justify-between border-b border-th-border text-[12.5px] font-mono">
            <div className="flex items-center gap-4">
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
            {tab === "body" && response.body && (
              <div className="flex items-center gap-2 pb-2">
                <button
                  onClick={() => setSearchOpen((open) => !open)}
                  title="Search in response"
                  className={`shrink-0 w-6 h-6 grid place-items-center rounded-md border transition-colors ${
                    searchOpen
                      ? "border-th-accent-border bg-th-accent-bg text-th-accent-text"
                      : "border-th-border-input text-th-text-3 hover:text-th-text-1 hover:border-th-text-4"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
                <button
                  onClick={handleCopy}
                  title="Copy response body"
                  className="shrink-0 w-6 h-6 grid place-items-center rounded-md border border-th-border-input text-th-text-3 hover:text-th-text-1 hover:border-th-text-4 transition-colors"
                >
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            )}
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
            <div ref={bodyContentRef}>
              <CodeView value={displayedBody} className="-mx-4 -my-3" />
            </div>
          ) : (
            <span className="text-th-text-4 text-[12.5px] font-mono">(empty body)</span>
          )
        ) : (
          response.metadata.length > 0 ? (
            <div className="-mx-4 -my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px] font-mono">
                <thead>
                  <tr className="border-b border-th-border">
                    <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-4 py-2 w-[38%]">Name</th>
                    <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-4 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {response.metadata.map(([key, value], index) => (
                    <tr key={`${key}-${index}`} className="border-b border-th-border last:border-0 hover:bg-th-hover">
                      <td className="align-top px-4 py-1.5 text-th-accent-text">{key}</td>
                      <td className="align-top px-4 py-1.5 text-th-text-2 break-all">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <span className="text-th-text-4 text-[12.5px] font-mono">no metadata</span>
          )
        )}
      </div>

      {searchOpen && tab === "body" && (
        <div className="absolute top-11 right-4 z-30 flex items-center gap-1 bg-th-elevated border border-th-border rounded-md shadow-xl px-2 py-1.5">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setSearchOpen(false);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) goPrev();
                else goNext();
              }
            }}
            placeholder="Search…"
            className="w-40 bg-th-bg border border-th-border-input rounded px-2 py-1 text-[12px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
          />
          <span className="text-[11px] font-mono text-th-text-4 w-16 text-center shrink-0">
            {searchQuery ? (matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : "0 results") : ""}
          </span>
          <button
            onClick={() => setUseRegexSearch((value) => !value)}
            title="Use regular expression"
            className={`shrink-0 w-6 h-6 grid place-items-center rounded text-[11px] font-mono ${useRegexSearch ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1 hover:bg-th-hover"}`}
          >
            .*
          </button>
          <button
            onClick={() => setCaseSensitive((value) => !value)}
            title="Match case"
            className={`shrink-0 w-6 h-6 grid place-items-center rounded text-[11px] font-mono ${caseSensitive ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1 hover:bg-th-hover"}`}
          >
            Aa
          </button>
          <button
            onClick={() => setWholeWord((value) => !value)}
            title="Match whole word"
            className={`shrink-0 w-6 h-6 grid place-items-center rounded text-[11px] font-mono ${wholeWord ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1 hover:bg-th-hover"}`}
          >
            W
          </button>
          <div className="w-px h-4 bg-th-border mx-0.5" />
          <button onClick={goPrev} title="Previous match" className="shrink-0 w-6 h-6 grid place-items-center rounded text-th-text-3 hover:text-th-text-1 hover:bg-th-hover">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
          <button onClick={goNext} title="Next match" className="shrink-0 w-6 h-6 grid place-items-center rounded text-th-text-3 hover:text-th-text-1 hover:bg-th-hover">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          <button onClick={() => setSearchOpen(false)} title="Close" className="shrink-0 w-6 h-6 grid place-items-center rounded text-th-text-3 hover:text-th-text-1 hover:bg-th-hover">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default function GrpcResponsePanel({ log, streaming, methodType, lastResponse }: {
  log: GrpcLogEntry[];
  streaming: boolean;
  methodType: GrpcMethodType;
  lastResponse: GrpcResponseSummary | null;
}) {
  const [mode, setMode] = useState<"response" | "log">("response");

  useEffect(() => {
    if (streaming) setMode(methodType === "unary" ? "response" : "log");
  }, [streaming, methodType]);

  if (log.length === 0 && !streaming) {
    return (
      <div
        className="h-full grid place-items-center text-th-text-4 text-[13px] font-mono"
        onMouseEnter={() => setActiveSearchRegion("response")}
        onMouseDown={() => setActiveSearchRegion("response")}
      >
        response will appear here
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      onMouseEnter={() => setActiveSearchRegion("response")}
      onMouseDownCapture={() => setActiveSearchRegion("response")}
      onFocusCapture={() => setActiveSearchRegion("response")}
    >
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
