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

// Where a variable's hover tooltip/click-to-navigate should point — mirrors
// the actual resolution order (Global, then the active environment
// overriding it) so the shown value matches what a send would substitute,
// but still surfaces variables that only exist in a non-active environment
// (so hovering one of those isn't blank just because it's not selected).
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

// Finds the {{variable}} token (if any) whose span sits at these viewport
// coordinates, by checking the overlay's actual rendered spans directly
// (see urlHighlight.tsx's data-var attribute) — NOT by asking the browser
// "what's the topmost element here" (document.caretRangeFromPoint /
// elementFromPoint), because the overlay sits UNDER a transparent real
// <input> (needed for actual text editing — see UrlInput/ValueInput) and
// that hit-test would almost always resolve to the input instead of the
// span beneath it. Comparing getBoundingClientRect() directly sidesteps
// stacking/pointer-events entirely.
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

// Tracks which {{variable}} token is under the mouse. `listenRef` is the
// element that actually receives mouse events (the input sits on top, but
// mousemove bubbles up to this shared ancestor); `overlayRef` is where the
// token spans live. Uses rAF-throttled mousemove polling since the overlay
// itself (pointer-events: none) can never receive hover events directly.
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

// Same geometric lookup, exposed standalone for click handlers (which fire
// once, synchronously, and don't need the hover hook's rAF polling/state).
export function variableTokenAtElement(overlayEl: HTMLElement | null, clientX: number, clientY: number): string | null {
  return overlayEl ? tokenAt(overlayEl, clientX, clientY) : null;
}

// Whether Cmd (mac) or Ctrl (Windows/Linux) is currently held — tracked via
// window-level key listeners rather than reading e.metaKey off mousemove,
// so the cursor updates the instant the modifier is pressed/released even
// if the mouse hasn't moved since. Cleared on window blur so a modifier
// released while the app wasn't focused doesn't get stuck "held".
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
