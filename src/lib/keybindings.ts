// Command-id based keybindings, like VS Code. Components register a handler
// for an action id, the global dispatcher just maps combo -> id -> handler.
// Keeps the binding table decoupled from wherever an action actually lives.

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
  { id: "view.runner", label: "Open Runner", category: "View", defaultCombo: "mod+r" },
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

// Empty string is a valid combo: that's how a binding gets cleared.
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

// --- Command registry ---
// No-op if nothing's registered for an id yet (e.g. no workspace open).

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

// --- Contextual search region ---
// mod+f means different things in the sidebar vs a response body. Instead of
// two separate rebindable slots (confusing "conflict" in Settings for binds
// that are never both live at once), track which pane was last focused and
// redirect "sidebar.search" to "response.search" when needed.
export type SearchRegion = "sidebar" | "response";
let activeSearchRegion: SearchRegion = "sidebar";

export function setActiveSearchRegion(region: SearchRegion) {
  activeSearchRegion = region;
}

export function getActiveSearchRegion(): SearchRegion {
  return activeSearchRegion;
}

// --- Combo <-> keyboard event ---

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

const IGNORED_KEYS = new Set(["control", "meta", "shift", "alt", "os", "contextmenu"]);

// Normalizes a KeyboardEvent to a stable string like "mod+shift+s".
// "mod" is Cmd on macOS, Ctrl elsewhere, so one combo works on both.
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

// "mod+shift+s" -> ["⌘","⇧","S"] on macOS, ["Ctrl","Shift","S"] elsewhere.
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

// A combo maps to one action at a time. Conflicts aren't blocked here,
// just surfaced as warnings in the Settings UI.
export function actionForCombo(combo: string): string | null {
  for (const def of KEYBINDING_DEFS) {
    if (getEffectiveCombo(def.id) === combo) return def.id;
  }
  return null;
}
