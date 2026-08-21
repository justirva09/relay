// app-level console capture, separate from the per-request Console tab in
// ResponsePanel. Taps window.console plus uncaught errors/rejections so
// users can self-diagnose without opening real devtools. Import once, early
// (main.tsx), for the side effects.

export type DevLogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface DevLogEntry {
  id: number;
  timestamp: number;
  level: DevLogLevel;
  message: string;
  stack?: string;
}

const MAX_ENTRIES = 500;

let entries: DevLogEntry[] = [];
let nextId = 1;
const listeners = new Set<(entries: DevLogEntry[]) => void>();

function push(level: DevLogLevel, message: string, stack?: string) {
  entries = [...entries, { id: nextId++, timestamp: Date.now(), level, message, stack }].slice(-MAX_ENTRIES);
  listeners.forEach((l) => l(entries));
}

function safeStringify(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatArgs(args: any[]): string {
  return args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" ");
}

const LEVELS: DevLogLevel[] = ["log", "info", "warn", "error", "debug"];
LEVELS.forEach((level) => {
  const original = console[level].bind(console);
  console[level] = (...args: any[]) => {
    original(...args);
    push(level, formatArgs(args));
  };
});

window.addEventListener("error", (e) => {
  push("error", e.message, e.error?.stack);
});

window.addEventListener("unhandledrejection", (e) => {
  const reason: any = e.reason;
  push("error", `Unhandled promise rejection: ${reason?.message ?? String(reason)}`, reason?.stack);
});

export function subscribeDevConsole(listener: (entries: DevLogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

export function clearDevConsole() {
  entries = [];
  listeners.forEach((l) => l(entries));
}
