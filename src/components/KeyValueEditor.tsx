import React, { useRef, useState } from "react";
import { KVRow, newRow, uid } from "../types";
import { useVariableMenu, VariableGroup } from "../lib/useVariableMenu";
import VariableMenuList from "./VariableMenuList";
import { highlightUrlTokens } from "../lib/urlHighlight";
import AnchorPortal from "./AnchorPortal";

interface Props {
  rows: KVRow[];
  onChangeRows: (rows: KVRow[]) => void;
  placeholderKey: string;
  placeholderVal: string;
  showToggle?: boolean;
  variables?: VariableGroup[];
  lockedKeys?: string[];
}

export function ValueInput({ value, onChange, placeholder, variables, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  variables?: VariableGroup[];
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const { menu, recompute, close, move, hover, apply } = useVariableMenu(variables);

  const syncScroll = () => {
    requestAnimationFrame(() => {
      if (inputRef.current && overlayRef.current) overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    });
  };

  const select = (item: string) => {
    const result = apply(value, item);
    if (!result) return;
    onChange(result.next);
    close();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (inputRef.current) inputRef.current.selectionStart = inputRef.current.selectionEnd = result.cursor;
    });
  };

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <div
        className={`relative overflow-hidden bg-th-surface border rounded-md ${focused ? "border-th-border-focus" : "border-th-border-input"}`}
        onClick={() => inputRef.current?.focus()}
      >
        <div ref={overlayRef} className="px-2.5 py-1.5 text-[13px] font-mono whitespace-pre overflow-hidden pointer-events-none" aria-hidden>
          {value ? highlightUrlTokens(value, false) : <span className="text-th-text-4">{placeholder}</span>}
        </div>
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          onChange={(e) => { onChange(e.target.value); syncScroll(); recompute(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onKeyDown={(e) => {
            if (!menu) return;
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(menu.items[menu.activeIndex].name); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
          }}
          onKeyUp={(e) => {
            syncScroll();
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) recompute(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          }}
          onScroll={syncScroll}
          onFocus={() => { setFocused(true); syncScroll(); }}
          onBlur={() => { setFocused(false); close(); }}
          placeholder={placeholder}
          className="absolute inset-0 w-full h-full px-2.5 py-1.5 text-[13px] font-mono bg-transparent text-transparent caret-th-text-1 focus:outline-none disabled:cursor-not-allowed"
          style={{ caretColor: "var(--c-text-1)" }}
        />
      </div>
      {menu && (
        <AnchorPortal anchorRef={wrapRef}>
          <VariableMenuList
            items={menu.items}
            activeIndex={menu.activeIndex}
            onHover={hover}
            onSelect={select}
            style={{ top: "100%", left: `${menu.col}ch`, marginTop: "4px" }}
          />
        </AnchorPortal>
      )}
    </div>
  );
}

function serializeBulk(rows: KVRow[]): string {
  return rows
    .filter((r) => r.key.trim() || r.value.trim())
    .map((r) => `${r.enabled ? "" : "// "}${r.key}: ${r.value}`)
    .join("\n");
}

function parseBulk(text: string): KVRow[] {
  const rows: KVRow[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) continue;
    const disabled = /^\s*\/\/\s?/.test(rawLine);
    const line = rawLine.replace(/^\s*\/\/\s?/, "");
    const idx = line.indexOf(":");
    const key = (idx === -1 ? line : line.slice(0, idx)).trim();
    const value = idx === -1 ? "" : line.slice(idx + 1).trim();
    if (!key && !value) continue;
    rows.push({ id: uid(), key, value, enabled: !disabled });
  }
  return rows.length ? rows : [newRow()];
}

export default function KeyValueEditor({ rows, onChangeRows, placeholderKey, placeholderVal, showToggle = true, variables, lockedKeys }: Props) {
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const commit = (rowsIn: KVRow[]) => {
    let out = rowsIn;
    const last = out[out.length - 1];
    if (last && (last.key.trim() || last.value.trim())) out = [...out, newRow()];
    while (out.length >= 2) {
      const l1 = out[out.length - 1];
      const l2 = out[out.length - 2];
      const l1Empty = !l1.key.trim() && !l1.value.trim();
      const l2Empty = !l2.key.trim() && !l2.value.trim();
      if (l1Empty && l2Empty) out = out.slice(0, -1);
      else break;
    }
    if (out.length === 0) out = [newRow()];
    onChangeRows(out);
  };

  const update = (id: string, field: keyof KVRow, val: string | boolean) =>
    commit(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));

  const remove = (id: string) => {
    let filtered = rows.filter((r) => r.id !== id);
    if (filtered.length === 0) filtered = [newRow()];
    onChangeRows(filtered);
  };

  const enterBulkMode = () => {
    setBulkText(serializeBulk(rows));
    setBulkMode(true);
  };

  const exitBulkMode = () => {
    commit(parseBulk(bulkText));
    setBulkMode(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-end">
        <button
          onClick={() => (bulkMode ? exitBulkMode() : enterBulkMode())}
          className="px-2 py-0.5 rounded text-[11px] font-mono text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
        >
          {bulkMode ? "Key-Value Edit" : "Bulk Edit"}
        </button>
      </div>
      {bulkMode ? (
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={`${placeholderKey}: ${placeholderVal}\n// disabled-row: value`}
          rows={Math.max(4, rows.length)}
          className="w-full resize-y bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
        />
      ) : (
        <>
          {rows.map((r) => {
            const locked = !!lockedKeys?.some((lk) => lk.toLowerCase() === r.key.trim().toLowerCase());
            return (
              <div key={r.id} className={`flex items-center gap-2 ${locked ? "opacity-60" : ""}`}>
                {showToggle && (
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={locked}
                    onChange={(e) => update(r.id, "enabled", e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--c-accent)] shrink-0 disabled:cursor-not-allowed"
                  />
                )}
                <input
                  value={r.key}
                  disabled={locked}
                  onChange={(e) => update(r.id, "key", e.target.value)}
                  placeholder={placeholderKey}
                  className="flex-1 min-w-0 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus disabled:cursor-not-allowed"
                />
                <ValueInput
                  value={locked ? "managed by Auth tab" : r.value}
                  onChange={(v) => update(r.id, "value", v)}
                  placeholder={placeholderVal}
                  variables={variables}
                  disabled={locked}
                />
                {locked ? (
                  <span title="Managed by the Auth tab" className="shrink-0 h-6 w-6 grid place-items-center text-th-text-4">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  </span>
                ) : (
                  <button
                    onClick={() => remove(r.id)}
                    className="shrink-0 h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                    aria-label="Remove row"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          <span className="text-[11px] text-th-text-4 font-mono">start typing to add a row</span>
        </>
      )}
    </div>
  );
}
