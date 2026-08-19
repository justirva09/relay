// A small VS Code-style command system: every rebindable shortcut has a
// stable action id and a default combo. Whoever actually implements an
// action (Sidebar, the main tab area, EnvironmentBar, ...) registers a
// handler for that id wherever it happens to live — the global keydown
// listener (see useKeybindingDispatcher in App.tsx) never needs to know
// where an action's logic lives, just which id the pressed combo maps to.
// This is what makes it "full rebindable from the start": a component can
// change its own handler freely without ever touching the binding table.

export interface KeybindingDef {
  id: string;
  label: string;
  category: string;
  defaultCombo: string;
}

export const KEYBINDING_DEFS: KeybindingDef[] = [
  { id: "tab.save", label: "Save", category: "Tabs", defaultCombo: "mod+s" },
  { id: "tab.saveAll", label: "Save All Tabs", category: "Tabs", defaultCombo: "mod+shift+s" },
  { id: "tab.close", label: "Close Tab", category: "Tabs", defaultCombo: "mod+w" },
  { id: "tab.closeAll", label: "Close All Tabs", category: "Tabs", defaultCombo: "mod+shift+w" },
  { id: "tab.next", label: "Switch to Next Tab", category: "Tabs", defaultCombo: "mod+shift+]" },
  { id: "tab.previous", label: "Switch to Previous Tab", category: "Tabs", defaultCombo: "mod+shift+[" },

  { id: "request.send", label: "Send Request", category: "Requests", defaultCombo: "mod+enter" },
  { id: "request.new", label: "New HTTP Request", category: "Requests", defaultCombo: "mod+n" },
  { id: "request.newFolder", label: "New Folder", category: "Requests", defaultCombo: "mod+shift+n" },

  { id: "sidebar.search", label: "Search Sidebar", category: "Sidebar", defaultCombo: "mod+f" },
  { id: "sidebar.duplicate", label: "Duplicate Item", category: "Sidebar", defaultCombo: "mod+d" },

  { id: "view.settings", label: "Open Settings", category: "View", defaultCombo: "mod+," },
  { id: "view.compareBranches", label: "Compare Branches", category: "View", defaultCombo: "mod+shift+b" },
];

const OVERRIDES_KEY = "relay-keybindings-overrides";

function loadOverrides(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
  } catch {
    return {};
  }
}

let overrides: Record<string, string> = loadOverrides();
const changeListeners = new Set<() => void>();

function persist() {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  changeListeners.forEach((l) => l());
}

export function getEffectiveCombo(id: string): string {
  if (overrides[id] !== undefined) return overrides[id];
  return KEYBINDING_DEFS.find((d) => d.id === id)?.defaultCombo ?? "";
}

export function isCustomized(id: string): boolean {
  return overrides[id] !== undefined;
}

// Empty string ("") intentionally allowed — that's how a binding gets
// unassigned (user can clear it without picking a replacement combo).
export function setCombo(id: string, combo: string) {
  overrides = { ...overrides, [id]: combo };
  persist();
}

export function resetCombo(id: string) {
  if (!(id in overrides)) return;
  const next = { ...overrides };
  delete next[id];
  overrides = next;
  persist();
}

export function resetAllCombos() {
  overrides = {};
  persist();
}

export function subscribeKeybindings(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

// --- Command registry -------------------------------------------------
// Components register a live handler for an action id while mounted; the
// global dispatcher just looks up the id the pressed combo resolves to and
// calls whatever's currently registered (a no-op if nothing is, e.g. no
// workspace open yet).

type ActionHandler = () => void;
const handlers = new Map<string, ActionHandler>();

export function registerAction(id: string, handler: ActionHandler): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

export function runAction(id: string): boolean {
  const h = handlers.get(id);
  if (!h) return false;
  h();
  return true;
}

// --- Contextual search region ------------------------------------------
// "Search" (mod+f) means different things depending on which pane you're
// actually working in — the sidebar's request tree, or a response body's
// own in-content search. Rather than give each its own rebindable slot
// (which would just show as a confusing "conflict" in Settings for two
// binds that are never really both live at once), the dispatcher checks
// this before firing "sidebar.search" and redirects to "response.search"
// when the response pane is the one you were just in. Panes update this
// on mouseenter — see Sidebar.tsx / ResponsePanel.tsx.
export type SearchRegion = "sidebar" | "response";
let activeSearchRegion: SearchRegion = "sidebar";

export function setActiveSearchRegion(region: SearchRegion) {
  activeSearchRegion = region;
}

export function getActiveSearchRegion(): SearchRegion {
  return activeSearchRegion;
}

// --- Combo <-> keyboard event -------------------------------------------

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

const IGNORED_KEYS = new Set(["control", "meta", "shift", "alt", "os", "contextmenu"]);

// Normalizes a KeyboardEvent into a stable, order-independent string like
// "mod+shift+s" — "mod" stands for Cmd on macOS / Ctrl elsewhere, so one
// stored combo works cross-platform without a separate mac/win table.
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  if (!IGNORED_KEYS.has(key)) parts.push(key);
  return parts.join("+");
}

const KEY_LABELS: Record<string, string> = {
  enter: "↵",
  escape: "Esc",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

// Splits a combo into display chips, e.g. "mod+shift+s" -> ["⌘","⇧","S"] on
// macOS or ["Ctrl","Shift","S"] elsewhere.
export function comboToChips(combo: string): string[] {
  if (!combo) return [];
  const mac = isMac();
  return combo.split("+").map((part) => {
    if (part === "mod") return mac ? "⌘" : "Ctrl";
    if (part === "shift") return mac ? "⇧" : "Shift";
    if (part === "alt") return mac ? "⌥" : "Alt";
    return KEY_LABELS[part] ?? part.toUpperCase();
  });
}

// Which action id (if any) the given combo currently triggers — a combo can
// only ever map to one action at a time (setCombo silently wins the most
// recent assignment; conflict warnings are surfaced in the Settings UI
// instead of enforced here).
export function actionForCombo(combo: string): string | null {
  for (const def of KEYBINDING_DEFS) {
    if (getEffectiveCombo(def.id) === combo) return def.id;
  }
  return null;
}
