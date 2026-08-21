import { useEffect, useRef, useState } from "react";
import { Workspace } from "../types";

export interface HoveredVar {
  name: string;
  x: number;
  y: number;
}

export interface VariableInfoEntry {
  value: string;
  label: string; // "Global" or an environment's name, for display
  tabId: string; // "globals" or an environment id, for openEnvironmentModal
}

export type VariableInfo = Record<string, VariableInfoEntry>;

// Mirrors real variable resolution (Global, then active environment
// overrides it), so hover/click shows what a send would actually use. Still
// surfaces vars from a non-active environment so hovering one isn't blank.
export function buildVariableInfo(workspace: Workspace): VariableInfo {
  const info: VariableInfo = {};
  for (const v of workspace.variables) {
    if (v.key.trim()) info[v.key] = { value: v.value, label: "Global", tabId: "globals" };
  }
  const activeEnv = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
  if (activeEnv) {
    for (const v of activeEnv.variables) {
      if (v.key.trim()) info[v.key] = { value: v.value, label: activeEnv.name, tabId: activeEnv.id };
    }
  }
  for (const env of workspace.environments) {
    if (env.id === workspace.activeEnvironmentId) continue;
    for (const v of env.variables) {
      if (v.key.trim() && !(v.key in info)) info[v.key] = { value: v.value, label: env.name, tabId: env.id };
    }
  }
  return info;
}

// Checks the overlay's rendered spans directly instead of asking the
// browser what's at these coordinates (elementFromPoint etc). The overlay
// sits under a transparent real <input>, so that kind of hit-test would
// just resolve to the input every time instead of the span underneath.
function tokenAt(overlayEl: HTMLElement, clientX: number, clientY: number): string | null {
  const spans = overlayEl.querySelectorAll<HTMLElement>("[data-var]");
  for (const span of spans) {
    const r = span.getBoundingClientRect();
    if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
      return span.getAttribute("data-var");
    }
  }
  return null;
}

// listenRef is the ancestor that actually gets mousemove (the input sits on
// top of it); overlayRef is where the token spans live. rAF-throttled since
// the overlay has pointer-events: none and can't get hover events itself.
export function useVariableHover(listenRef: React.RefObject<HTMLElement>, overlayRef: React.RefObject<HTMLElement>): HoveredVar | null {
  const [hovered, setHovered] = useState<HoveredVar | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const el = listenRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const name = overlayRef.current ? tokenAt(overlayRef.current, e.clientX, e.clientY) : null;
        setHovered(name ? { name, x: e.clientX, y: e.clientY } : null);
      });
    };
    const onLeave = () => setHovered(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [listenRef, overlayRef]);

  return hovered;
}

// Same lookup, standalone for click handlers that don't need the rAF/state overhead.
export function variableTokenAtElement(overlayEl: HTMLElement | null, clientX: number, clientY: number): string | null {
  return overlayEl ? tokenAt(overlayEl, clientX, clientY) : null;
}

// Tracks Cmd/Ctrl via key listeners instead of e.metaKey on mousemove, so
// the cursor updates immediately even without mouse movement. Cleared on
// blur so it doesn't get stuck "held" after an alt-tab.
export function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const isModifier = (e: KeyboardEvent) => e.key === "Meta" || e.key === "Control";
    const onDown = (e: KeyboardEvent) => isModifier(e) && setHeld(true);
    const onUp = (e: KeyboardEvent) => isModifier(e) && setHeld(false);
    const onBlur = () => setHeld(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return held;
}
