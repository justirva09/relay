import React, { useRef, useState } from "react";
import { KVRow, newRow, uid } from "../types";
import { useVariableMenu, VariableGroup } from "../lib/useVariableMenu";
import VariableMenuList from "./VariableMenuList";
import { highlightUrlTokens } from "../lib/urlHighlight";
import AnchorPortal from "./AnchorPortal";
import { useVariableHover, variableTokenAtElement, useModifierHeld, VariableInfo } from "../lib/useVariableHover";
import VariableHoverTooltip from "./VariableHoverTooltip";
import { useWorkspace } from "../store";

interface Props {
  rows: KVRow[];
  onChangeRows: (rows: KVRow[]) => void;
  placeholderKey: string;
  placeholderVal: string;
  showToggle?: boolean;
  variables?: VariableGroup[];
  variableInfo?: VariableInfo;
  lockedKeys?: string[];
  // Autocomplete for the Name column — only meaningful for actual HTTP
  // headers (Authorization, Content-Type, Relay's own X-Mock-Scenario, ...).
  // Omitted for query params/urlencoded/gRPC metadata, which stay plain
  // free-text input.
  keySuggestions?: string[];
}

// Plain free-text input with a filtered, click-or-Enter-to-pick suggestion
// list — deliberately simpler than ValueInput's {{variable}} autocomplete
// above (no cursor-position token matching needed, a header name is the
// whole field). Portals the dropdown like ValueInput's does, for the same
// reason: KeyValueEditor's table sits inside an overflow-x-auto wrapper
// elsewhere, which clips anything positioned via plain absolute/relative.
function KeyNameInput({
  value,
  onChange,
  placeholder,
  suggestions,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  suggestions: string[];
  disabled?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = value.trim() ? suggestions.filter((s) => s.toLowerCase().includes(value.trim().toLowerCase()) && s.toLowerCase() !== value.trim().toLowerCase()) : suggestions;

  const select = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIndex(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!open || filtered.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => (i + 1) % filtered.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length); }
          else if (e.key === "Enter" || e.key === "Tab") { if (filtered[activeIndex]) { e.preventDefault(); select(filtered[activeIndex]); } }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        placeholder={placeholder}
        className="w-full min-w-0 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus disabled:cursor-not-allowed"
      />
      {open && filtered.length > 0 && (
        <AnchorPortal anchorRef={wrapRef}>
          <div
            className="absolute z-50 min-w-[180px] max-w-[280px] max-h-[280px] overflow-y-auto bg-th-elevated border border-th-border rounded-md shadow-xl py-1 font-mono text-[12px]"
            style={{ top: "100%", left: 0, marginTop: "4px" }}
          >
            {filtered.map((name, i) => (
              <button
                key={name}
                onMouseDown={(e) => { e.preventDefault(); select(name); }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-2.5 py-1 truncate text-th-text-1 ${i === activeIndex ? "bg-th-hover" : ""}`}
              >
                {name}
              </button>
            ))}
          </div>
        </AnchorPortal>
      )}
    </div>
  );
}

export function ValueInput({ value, onChange, placeholder, variables, variableInfo, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  variables?: VariableGroup[];
  variableInfo?: VariableInfo;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const { menu, recompute, close, move, hover, apply } = useVariableMenu(variables);
  const { openEnvironmentModal } = useWorkspace();
  const hovered = useVariableHover(wrapRef, overlayRef);
  const modifierHeld = useModifierHeld();

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
        onClick={(e) => {
          if ((e.metaKey || e.ctrlKey) && variableInfo) {
            const name = variableTokenAtElement(overlayRef.current, e.clientX, e.clientY);
            const info = name ? variableInfo[name] : undefined;
            if (info) {
              openEnvironmentModal(info.tabId, name!);
              return;
            }
          }
          inputRef.current?.focus();
        }}
      >
        <div ref={overlayRef} className="px-2.5 py-1.5 text-[13px] font-mono whitespace-pre overflow-hidden pointer-events-none" aria-hidden>
          {value ? highlightUrlTokens(value, false, variables) : <span className="text-th-text-4">{placeholder}</span>}
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
          style={{ caretColor: "var(--c-text-1)", cursor: hovered && modifierHeld ? "pointer" : undefined }}
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
      {hovered && <VariableHoverTooltip x={hovered.x} y={hovered.y} name={hovered.name} info={variableInfo?.[hovered.name]} />}
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

export default function KeyValueEditor({ rows, onChangeRows, placeholderKey, placeholderVal, showToggle = true, variables, variableInfo, lockedKeys, keySuggestions }: Props) {
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
    <div className="flex flex-col gap-1.5 pb-4">
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
          <div className="overflow-x-auto border border-th-border rounded-md">
            <table className="w-full border-collapse text-[13px] font-mono">
              <thead>
                <tr className="border-b border-th-border">
                  {showToggle && <th className="w-8 px-2 py-2" />}
                  <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-2 py-2 w-[26%]">Name</th>
                  <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-2 py-2 w-[34%]">Value</th>
                  <th className="text-left font-medium text-th-text-3 text-[11px] uppercase tracking-wide px-2 py-2">Description</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const locked = !!lockedKeys?.some((lk) => lk.toLowerCase() === r.key.trim().toLowerCase());
                  return (
                    <tr key={r.id} className={`border-b border-th-border last:border-0 ${locked ? "opacity-60" : ""}`}>
                      {showToggle && (
                        <td className="px-2 py-1.5 align-middle">
                          <div className="grid place-items-center">
                            <input
                              type="checkbox"
                              checked={r.enabled}
                              disabled={locked}
                              onChange={(e) => update(r.id, "enabled", e.target.checked)}
                              className="h-3.5 w-3.5 accent-[var(--c-accent)] shrink-0 disabled:cursor-not-allowed"
                            />
                          </div>
                        </td>
                      )}
                      <td className="px-2 py-1.5 align-middle">
                        {keySuggestions ? (
                          <KeyNameInput
                            value={r.key}
                            disabled={locked}
                            onChange={(v) => update(r.id, "key", v)}
                            placeholder={placeholderKey}
                            suggestions={keySuggestions}
                          />
                        ) : (
                          <input
                            value={r.key}
                            disabled={locked}
                            onChange={(e) => update(r.id, "key", e.target.value)}
                            placeholder={placeholderKey}
                            className="w-full min-w-0 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus disabled:cursor-not-allowed"
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <ValueInput
                          value={locked ? "managed by Auth tab" : r.value}
                          onChange={(v) => update(r.id, "value", v)}
                          placeholder={placeholderVal}
                          variables={variables}
                          variableInfo={variableInfo}
                          disabled={locked}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <input
                          value={r.description ?? ""}
                          disabled={locked}
                          onChange={(e) => update(r.id, "description", e.target.value)}
                          placeholder="Description"
                          className="w-full min-w-0 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <div className="grid place-items-center">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <span className="text-[11px] text-th-text-4 font-mono">start typing to add a row</span>
        </>
      )}
    </div>
  );
}
