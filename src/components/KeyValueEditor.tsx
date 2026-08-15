import React from "react";
import { KVRow, newRow } from "../types";

interface Props {
  rows: KVRow[];
  onChangeRows: (rows: KVRow[]) => void;
  placeholderKey: string;
  placeholderVal: string;
  showToggle?: boolean;
}

export default function KeyValueEditor({ rows, onChangeRows, placeholderKey, placeholderVal, showToggle = true }: Props) {
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
          <input
            value={r.value}
            onChange={(e) => update(r.id, "value", e.target.value)}
            placeholder={placeholderVal}
            className="flex-1 min-w-0 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
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
