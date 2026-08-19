import React from "react";
import { VarItem } from "../lib/useVariableMenu";

export default function VariableMenuList({
  items,
  activeIndex,
  onHover,
  onSelect,
  style,
}: {
  items: VarItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (name: string) => void;
  style: React.CSSProperties;
}) {
  let lastCategory: string | null = null;
  return (
    <div
      className="absolute z-50 min-w-[160px] max-w-[240px] max-h-[320px] overflow-y-auto bg-th-elevated border border-th-border rounded-md shadow-xl py-1 font-mono text-[12px]"
      style={style}
    >
      {items.map((item, i) => {
        const showHeader = item.category !== lastCategory;
        lastCategory = item.category;
        return (
          <React.Fragment key={`${item.category}:${item.name}`}>
            {showHeader && (
              <div className="px-2.5 pt-2 pb-1 text-[10px] text-th-text-3 uppercase tracking-wide">{item.category}</div>
            )}
            <button
              onMouseDown={(e) => { e.preventDefault(); onSelect(item.name); }}
              onMouseEnter={() => onHover(i)}
              className={`w-full flex items-center justify-between gap-3 px-2.5 py-1 text-left ${i === activeIndex ? "bg-th-hover" : ""}`}
            >
              <span className="text-th-text-1 truncate">{item.name}</span>
              <span className="text-th-text-4 truncate shrink-0">variable</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
