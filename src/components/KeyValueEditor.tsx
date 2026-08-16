import React, { useRef, useState } from "react";
import { KVRow, newRow } from "../types";
import { useVariableMenu } from "../lib/useVariableMenu";
import VariableMenuList from "./VariableMenuList";
import { highlightUrlTokens } from "../lib/urlHighlight";

interface Props {
  rows: KVRow[];
  onChangeRows: (rows: KVRow[]) => void;
  placeholderKey: string;
  placeholderVal: string;
  showToggle?: boolean;
  variables?: string[];
}

export function ValueInput({ value, onChange, placeholder, variables }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  variables?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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
    <div className="relative flex-1 min-w-0">
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
          onChange={(e) => { onChange(e.target.value); syncScroll(); recompute(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onKeyDown={(e) => {
            if (!menu) return;
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(menu.items[menu.activeIndex]); }
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
          className="absolute inset-0 w-full h-full px-2.5 py-1.5 text-[13px] font-mono bg-transparent text-transparent caret-th-text-1 focus:outline-none"
          style={{ caretColor: "var(--c-text-1)" }}
        />
      </div>
      {menu && (
        <VariableMenuList
          items={menu.items}
          activeIndex={menu.activeIndex}
          onHover={hover}
          onSelect={select}
          style={{ top: "100%", left: `${menu.col}ch`, marginTop: "4px" }}
        />
      )}
    </div>
  );
}

export default function KeyValueEditor({ rows, onChangeRows, placeholderKey, placeholderVal, showToggle = true, variables }: Props) {
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

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          {showToggle && (
            <input
              type="checkbox"
              checked={r.enabled}
              onChange={(e) => update(r.id, "enabled", e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--c-accent)] shrink-0"
            />
          )}
          <input
            value={r.key}
            onChange={(e) => update(r.id, "key", e.target.value)}
            placeholder={placeholderKey}
            className="flex-1 min-w-0 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
          />
          <ValueInput
            value={r.value}
            onChange={(v) => update(r.id, "value", v)}
            placeholder={placeholderVal}
            variables={variables}
          />
          <button
            onClick={() => remove(r.id)}
            className="shrink-0 h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
            aria-label="Remove row"
          >
            ×
          </button>
        </div>
      ))}
      <span className="text-[11px] text-th-text-4 font-mono">start typing to add a row</span>
    </div>
  );
}
