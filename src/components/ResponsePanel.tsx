import React, { useState, useEffect, useRef, useMemo } from "react";
import { ResponseState } from "../types";
import { isJson } from "./JsonTree";
import CodeView from "./CodeView";
import { useTextHighlight } from "../lib/useTextHighlight";
import { registerAction, setActiveSearchRegion } from "../lib/keybindings";
import ToggleSwitch from "./ToggleSwitch";

type BodyFormat = "json" | "html" | "xml" | "javascript" | "raw" | "hex" | "base64";

const FORMAT_OPTIONS: { key: BodyFormat; label: string; icon: string }[] = [
  { key: "json", label: "JSON", icon: "{ }" },
  { key: "html", label: "HTML", icon: "</>" },
  { key: "xml", label: "XML", icon: "◨" },
  { key: "javascript", label: "JavaScript", icon: "JS" },
  { key: "raw", label: "Raw", icon: "≡" },
  { key: "hex", label: "Hex", icon: "#" },
  { key: "base64", label: "Base64", icon: "%" },
];

function detectFormat(body: string, headers: [string, string][]): BodyFormat {
  // Body sniff wins over Content-Type — plenty of real APIs mislabel a JSON
  // response as text/html, and trusting a valid JSON.parse over a wrong
  // header beats surprising the user with the wrong tab selected.
  if (isJson(body)) return "json";
  const ct = (headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] || "").toLowerCase();
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("javascript") || ct.includes("ecmascript")) return "javascript";
  if (/^\s*</.test(body)) return body.includes("<html") || body.includes("<!DOCTYPE") ? "html" : "xml";
  return "raw";
}

function toHexDump(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const offset = i.toString(16).padStart(8, "0");
    const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const ascii = Array.from(chunk).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${offset}  ${hex}  ${ascii}`);
  }
  return lines.join("\n") || "(empty body)";
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

// The exact text each format branch below renders — shared with the Copy
// button so "copy" always grabs whatever's actually on screen, not always
// the raw wire body.
function getDisplayedText(body: string, format: BodyFormat): string {
  if (format === "json") return isJson(body) ? JSON.stringify(JSON.parse(body), null, 2) : body;
  if (format === "hex") return toHexDump(body);
  if (format === "base64") return toBase64(body);
  return body;
}

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
  const [respTab, setRespTab] = useState<"body" | "headers" | "tests" | "console">("body");
  const [saved, setSaved] = useState(false);
  const [format, setFormat] = useState<BodyFormat>("raw");
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [preview, setPreview] = useState(true);
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegexSearch, setUseRegexSearch] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (response) {
      setRespTab("body");
      setSaved(false);
      setSearchOpen(false);
      setSearchQuery("");
      if (!response.error && response.body) setFormat(detectFormat(response.body, response.headers));
    }
  }, [response]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (formatMenuRef.current && !formatMenuRef.current.contains(e.target as Node)) setFormatMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [formatMenuOpen]);

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
    [response, format, preview]
  );

  useEffect(
    () =>
      registerAction("response.search", () => {
        if (!response || response.error || !response.body) return;
        setRespTab("body");
        setSearchOpen(true);
      }),
    [response]
  );

  const handleCopy = () => {
    if (!response || response.error || !response.body) return;
    navigator.clipboard.writeText(getDisplayedText(response.body, format)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const testsPassed = response?.testResults.filter((t) => t.passed).length ?? 0;
  const testsTotal = response?.testResults.length ?? 0;

  const respTabs: { key: typeof respTab; label: string }[] = [{ key: "body", label: "Body" }];
  if (response && !response.error) respTabs.push({ key: "headers", label: `Headers (${response.headers.length})` });
  if (testsTotal > 0) respTabs.push({ key: "tests", label: `Tests (${testsPassed}/${testsTotal})` });
  if (response?.logs.length || response?.preError) respTabs.push({ key: "console", label: "Console" });

  return (
    <div className="h-full flex flex-col relative" onMouseEnter={() => setActiveSearchRegion("response")}>
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
              <div className="flex items-center justify-between border-b border-th-border text-[12.5px] font-mono">
                <div className="flex items-center gap-4">
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
                {respTab === "body" && !response.error && response.body && (
                  <div className="flex items-center gap-2 pb-2">
                    {format === "html" && <ToggleSwitch checked={preview} onChange={setPreview} label="Preview" />}
                    <button
                      onClick={() => setSearchOpen((o) => !o)}
                      title="Search in response"
                      className={`shrink-0 w-6 h-6 grid place-items-center rounded-md border transition-colors ${
                        searchOpen ? "border-th-accent-border bg-th-accent-bg text-th-accent-text" : "border-th-border-input text-th-text-3 hover:text-th-text-1 hover:border-th-text-4"
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
                    <div ref={formatMenuRef} className="relative">
                      <button
                        onClick={() => setFormatMenuOpen((o) => !o)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4 text-[11.5px]"
                      >
                        {FORMAT_OPTIONS.find((f) => f.key === format)?.label ?? "Raw"}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                      {formatMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 w-40 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 z-20">
                          {FORMAT_OPTIONS.map((f) => (
                            <button
                              key={f.key}
                              onClick={() => {
                                setFormat(f.key);
                                setFormatMenuOpen(false);
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] ${
                                format === f.key ? "text-th-accent-text bg-th-accent-bg" : "text-th-text-2 hover:bg-th-hover hover:text-th-text-1"
                              }`}
                            >
                              <span className="w-5 text-center text-[10px] text-th-text-4">{f.icon}</span>
                              {f.label}
                              {format === f.key && <span className="ml-auto">✓</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
                <div ref={bodyContentRef}>
                  {format === "json" ? (
                    <CodeView value={getDisplayedText(response.body, format)} className="-mx-4 -my-3" />
                  ) : format === "html" && preview ? (
                    <iframe
                      aria-label="Response preview"
                      sandbox=""
                      srcDoc={response.body}
                      className="w-full h-full border-0 bg-white rounded-md"
                      style={{ minHeight: 300 }}
                    />
                  ) : format === "raw" ? (
                    <pre className="text-[12.5px] font-mono text-th-text-1 whitespace-pre-wrap break-all leading-[1.6]">{response.body}</pre>
                  ) : format === "hex" ? (
                    <pre className="text-[12px] font-mono text-th-text-1 whitespace-pre leading-[1.6] overflow-x-auto">{getDisplayedText(response.body, format)}</pre>
                  ) : format === "base64" ? (
                    <pre className="text-[12.5px] font-mono text-th-text-1 whitespace-pre-wrap break-all leading-[1.6]">{getDisplayedText(response.body, format)}</pre>
                  ) : (
                    <CodeView value={response.body} className="-mx-4 -my-3" />
                  )}
                </div>
              ) : (
                <span className="text-th-text-4 text-[12.5px] font-mono">(empty body)</span>
              )
            )}

            {response && !response.error && respTab === "headers" && (
              response.headers.length > 0 ? (
                <div className="-mx-4 -my-3 overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px] font-mono">
                    <thead>
                      <tr className="border-b border-th-border">
                        <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-4 py-2 w-[38%]">Name</th>
                        <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-4 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {response.headers.map(([k, v], i) => (
                        <tr key={`${k}-${i}`} className="border-b border-th-border last:border-0 hover:bg-th-hover">
                          <td className="align-top px-4 py-1.5 text-th-accent-text">{k}</td>
                          <td className="align-top px-4 py-1.5 text-th-text-2 break-all">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <span className="text-th-text-4 text-[12.5px] font-mono">no headers</span>
              )
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

      {searchOpen && respTab === "body" && (
        <div className="absolute top-11 right-4 z-30 flex items-center gap-1 bg-th-elevated border border-th-border rounded-md shadow-xl px-2 py-1.5">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setSearchOpen(false);
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) goPrev();
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
            onClick={() => setUseRegexSearch((v) => !v)}
            title="Use regular expression"
            className={`shrink-0 w-6 h-6 grid place-items-center rounded text-[11px] font-mono ${useRegexSearch ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1 hover:bg-th-hover"}`}
          >
            .*
          </button>
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            title="Match case"
            className={`shrink-0 w-6 h-6 grid place-items-center rounded text-[11px] font-mono ${caseSensitive ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1 hover:bg-th-hover"}`}
          >
            Aa
          </button>
          <button
            onClick={() => setWholeWord((v) => !v)}
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
