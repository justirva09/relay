import React from "react";

export default function VariableMenuList({
  items,
  activeIndex,
  onHover,
  onSelect,
  style,
}: {
  items: string[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <div
      className="absolute z-50 min-w-[160px] max-w-[240px] bg-th-elevated border border-th-border rounded-md shadow-xl py-1 font-mono text-[12px] overflow-hidden"
      style={style}
    >
      {items.map((item, i) => (
        <button
          key={item}
          onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
          onMouseEnter={() => onHover(i)}
          className={`w-full flex items-center justify-between gap-3 px-2.5 py-1 text-left ${i === activeIndex ? "bg-th-hover" : ""}`}
        >
          <span className="text-th-text-1 truncate">{item}</span>
          <span className="text-th-text-4 truncate shrink-0">variable</span>
        </button>
      ))}
    </div>
  );
}
