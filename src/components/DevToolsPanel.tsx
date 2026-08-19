import React, { useEffect, useMemo, useRef, useState } from "react";
import { DevLogEntry, DevLogLevel, subscribeDevConsole, clearDevConsole } from "../lib/devConsole";
import { getPerfStats, PerfStats } from "../lib/tauri";
import InfoTooltip from "./InfoTooltip";

const LEVEL_ORDER: DevLogLevel[] = ["info", "warn", "error", "debug", "log"];

const LEVEL_ICON: Record<DevLogLevel, React.ReactNode> = {
  info: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  warn: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  error: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  debug: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  log: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
};

const LEVEL_COLOR: Record<DevLogLevel, string> = {
  info: "text-sky-400",
  warn: "text-amber-400",
  error: "text-rose-400",
  debug: "text-th-text-3",
  log: "text-th-text-3",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function FilterDropdown({ entries, enabled, setEnabled }: { entries: DevLogEntry[]; enabled: Set<DevLogLevel>; setEnabled: (s: Set<DevLogLevel>) => void }) {
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

  const counts = useMemo(() => {
    const c: Record<DevLogLevel, number> = { info: 0, warn: 0, error: 0, debug: 0, log: 0 };
    for (const e of entries) c[e.level]++;
    return c;
  }, [entries]);

  const allOn = enabled.size === LEVEL_ORDER.length;
  const label = allOn ? "All" : enabled.size === 0 ? "None" : `${enabled.size}/${LEVEL_ORDER.length}`;

  const toggle = (level: DevLogLevel) => {
    const next = new Set(enabled);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    setEnabled(next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-mono text-th-text-2 border border-th-border-input hover:border-th-text-4"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        {label}
        <svg width="9" height="9" viewBox="0 0 10 10" className="shrink-0">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 z-50 w-56 bg-th-elevated border border-th-border rounded-md shadow-xl py-2">
          <div className="flex items-center justify-between px-3 pb-1.5 mb-1 border-b border-th-border">
            <span className="text-[12px] font-semibold text-th-text-1">Filter by Type</span>
            <button
              onClick={() => setEnabled(allOn ? new Set() : new Set(LEVEL_ORDER))}
              className="text-[11px] font-mono text-th-accent-text hover:underline"
            >
              {allOn ? "Hide All" : "Show All"}
            </button>
          </div>
          {LEVEL_ORDER.map((level) => (
            <label key={level} className="flex items-center gap-2 px-3 py-1.5 text-[12px] cursor-pointer hover:bg-th-hover">
              <input type="checkbox" checked={enabled.has(level)} onChange={() => toggle(level)} className="accent-th-accent" />
              <span className={`shrink-0 ${LEVEL_COLOR[level]}`}>{LEVEL_ICON[level]}</span>
              <span className="text-th-text-1 capitalize">{level}</span>
              <span className="ml-auto text-th-text-4 font-mono">({counts[level]})</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function StatCard({ icon, accent, label, tooltip, value, caption }: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  tooltip: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="flex-1 min-w-[150px] border border-th-border rounded-lg bg-th-bg px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className={`shrink-0 ${accent}`}>{icon}</span>
        <span className="text-[11.5px] font-medium text-th-text-2">{label}</span>
        <InfoTooltip text={tooltip} />
      </div>
      <p className="text-[22px] font-semibold text-th-text-1 font-mono leading-tight">{value}</p>
      <p className="text-[11px] text-th-text-4 mt-0.5">{caption}</p>
    </div>
  );
}

// Polls Rust's sysinfo-backed get_perf_stats every 1.5s while this tab is
// visible — a persistent System instance on the Rust side (see perf.rs)
// means every call after the first gets an accurate CPU% delta.
function PerformancePanel() {
  const [stats, setStats] = useState<PerfStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => getPerfStats().then((s) => !cancelled && setStats(s)).catch(() => {});
    poll();
    const id = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="p-4 overflow-y-auto">
      <p className="text-[11px] font-mono uppercase tracking-wide text-th-text-4 mb-3">System Resources — Main Process</p>
      <div className="flex flex-wrap gap-3">
        <StatCard
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
              <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /><line x1="18" y1="1" x2="18" y2="4" />
              <line x1="6" y1="20" x2="6" y2="23" /><line x1="10" y1="20" x2="10" y2="23" /><line x1="14" y1="20" x2="14" y2="23" /><line x1="18" y1="20" x2="18" y2="23" />
              <line x1="1" y1="6" x2="4" y2="6" /><line x1="1" y1="10" x2="4" y2="10" /><line x1="1" y1="14" x2="4" y2="14" /><line x1="1" y1="18" x2="4" y2="18" />
              <line x1="20" y1="6" x2="23" y2="6" /><line x1="20" y1="10" x2="23" y2="10" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="20" y1="18" x2="23" y2="18" />
            </svg>
          }
          accent="text-sky-400"
          label="CPU Usage"
          tooltip="Percent of one CPU core Relay is using right now. Relay runs as a single process — unlike some other apps that split into separate Browser/GPU/Tab processes, this number is the whole app."
          value={stats ? `${stats.cpu_percent.toFixed(1)}%` : "…"}
          caption="Total CPU usage"
        />
        <StatCard
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          }
          accent="text-violet-400"
          label="Memory Usage"
          tooltip="Resident memory (RAM) currently held by Relay's process, reported live by the OS."
          value={stats ? formatBytes(stats.memory_bytes) : "…"}
          caption="Total memory usage"
        />
        <StatCard
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          accent="text-amber-400"
          label="Uptime"
          tooltip="How long this Relay process has been running since it was launched."
          value={stats ? formatUptime(stats.uptime_secs) : "…"}
          caption="Process runtime"
        />
        <StatCard
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="7" y1="9" x2="17" y2="9" /><line x1="7" y1="13" x2="13" y2="13" />
            </svg>
          }
          accent="text-emerald-400"
          label="Process ID"
          tooltip="The OS process ID (PID) for Relay's main process — handy if you need to find it in Activity Monitor / Task Manager."
          value={stats ? String(stats.pid) : "…"}
          caption="Main process PID"
        />
      </div>
    </div>
  );
}

type DevToolsTab = "console" | "performance";

export default function DevToolsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<DevToolsTab>("console");
  const [entries, setEntries] = useState<DevLogEntry[]>([]);
  const [enabled, setEnabled] = useState<Set<DevLogLevel>>(new Set(LEVEL_ORDER));

  useEffect(() => subscribeDevConsole(setEntries), []);

  const visible = entries.filter((e) => enabled.has(e.level));

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 h-[320px] bg-th-surface border-t border-th-border shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-3 border-b border-th-border shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setTab("console")}
            className={`flex items-center gap-1.5 py-2.5 text-[12.5px] font-medium border-b-2 -mb-px ${
              tab === "console" ? "text-th-accent-text border-th-accent" : "text-th-text-3 border-transparent hover:text-th-text-1"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Console
          </button>
          <button
            onClick={() => setTab("performance")}
            className={`flex items-center gap-1.5 py-2.5 text-[12.5px] font-medium border-b-2 -mb-px ${
              tab === "performance" ? "text-th-accent-text border-th-accent" : "text-th-text-3 border-transparent hover:text-th-text-1"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 7 12 12 15 14.5" />
            </svg>
            Performance
          </button>
        </div>
        <div className="flex items-center gap-1.5 py-1.5">
          {tab === "console" && (
            <>
              <FilterDropdown entries={entries} enabled={enabled} setEnabled={setEnabled} />
              <button
                onClick={clearDevConsole}
                disabled={entries.length === 0}
                title="Clear console"
                className="h-7 w-7 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-th-text-3"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </>
          )}
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded text-th-text-3 hover:text-th-text-1 hover:bg-th-hover text-[16px]">
            ×
          </button>
        </div>
      </div>
      {tab === "console" ? (
        <div className="flex-1 overflow-y-auto font-mono text-[12px]">
          {entries.length === 0 ? (
            <p className="px-3 py-3 text-th-text-4">
              No output yet — this mirrors the app's own console (log/info/warn/error/debug) plus uncaught errors, app-wide.
            </p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-3 text-th-text-4">All entries hidden by the current filter.</p>
          ) : (
            visible.map((e) => (
              <div key={e.id} className="flex items-start gap-2.5 px-3 py-1.5 border-b border-th-border/60 hover:bg-th-hover">
                <span className="shrink-0 text-th-text-4 w-[92px]">{formatTime(e.timestamp)}</span>
                <span className={`shrink-0 mt-0.5 ${LEVEL_COLOR[e.level]}`}>{LEVEL_ICON[e.level]}</span>
                <span className="text-th-text-1 break-all whitespace-pre-wrap flex-1 min-w-0">
                  {e.message}
                  {e.stack && <pre className="mt-1 text-th-text-3 whitespace-pre-wrap break-all">{e.stack}</pre>}
                </span>
              </div>
            ))
          )}
        </div>
      ) : (
        <PerformancePanel />
      )}
    </div>
  );
}
