import React, { useEffect, useRef, useState } from "react";
import { FormDataRow, newFormDataRow } from "../types";
import { ValueInput } from "./KeyValueEditor";
import { pickAnyFile } from "../lib/tauri";
import { VariableGroup } from "../lib/useVariableMenu";

interface Props {
  rows: FormDataRow[];
  onChangeRows: (rows: FormDataRow[]) => void;
  variables?: VariableGroup[];
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

const TYPE_OPTIONS: { value: "text" | "file"; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "file", label: "File" },
];

function TypeSelect({ value, onChange }: { value: "text" | "file"; onChange: (v: "text" | "file") => void }) {
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

  const current = TYPE_OPTIONS.find((o) => o.value === value) ?? TYPE_OPTIONS[0];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 bg-th-surface border border-th-border-input rounded-md pl-2 pr-1.5 py-1.5 text-[12px] font-mono text-th-text-2 hover:border-th-text-4 w-[62px]"
      >
        <span className="flex-1 text-left">{current.label}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" className="text-th-text-3 shrink-0">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-full w-max">
          {TYPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full px-2.5 py-1.5 text-left text-[12px] font-mono hover:bg-th-hover whitespace-nowrap ${
                o.value === value ? "text-th-accent-text" : "text-th-text-2"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FormDataEditor({ rows, onChangeRows, variables }: Props) {
  const commit = (rowsIn: FormDataRow[]) => {
    let out = rowsIn;
    const last = out[out.length - 1];
    if (last && (last.key.trim() || last.value.trim())) out = [...out, newFormDataRow()];
    while (out.length >= 2) {
      const l1 = out[out.length - 1];
      const l2 = out[out.length - 2];
      const l1Empty = !l1.key.trim() && !l1.value.trim();
      const l2Empty = !l2.key.trim() && !l2.value.trim();
      if (l1Empty && l2Empty) out = out.slice(0, -1);
      else break;
    }
    if (out.length === 0) out = [newFormDataRow()];
    onChangeRows(out);
  };

  const update = (id: string, patch: Partial<FormDataRow>) =>
    commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => {
    let filtered = rows.filter((r) => r.id !== id);
    if (filtered.length === 0) filtered = [newFormDataRow()];
    onChangeRows(filtered);
  };

  const chooseFile = async (id: string) => {
    const path = await pickAnyFile();
    if (path) update(id, { value: path });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--c-accent)] shrink-0"
          />
          <input
            value={r.key}
            onChange={(e) => update(r.id, { key: e.target.value })}
            placeholder="key"
            className="flex-1 min-w-0 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
          />
          <TypeSelect value={r.type} onChange={(type) => update(r.id, { type, value: "" })} />
          {r.type === "file" ? (
            <button
              onClick={() => chooseFile(r.id)}
              className="flex-1 min-w-0 text-left truncate bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-2 hover:border-th-text-4"
            >
              {r.value ? basename(r.value) : <span className="text-th-text-4">Choose file…</span>}
            </button>
          ) : (
            <ValueInput value={r.value} onChange={(v) => update(r.id, { value: v })} placeholder="value" variables={variables} />
          )}
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
