import React, { useEffect, useRef, useState } from "react";
import FloatingMenu from "./FloatingMenu";

// native <select> can't be themed consistently across platforms
export default function SimpleSelect<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 hover:border-th-text-4"
      >
        <span className="flex-1 text-left truncate">{current?.label ?? value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-th-text-3 shrink-0">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <FloatingMenu ref={menuRef} anchorRef={ref} open={open} className="bg-th-elevated border border-th-border rounded-md shadow-xl py-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
            className="w-full px-3 py-1.5 text-left text-[13px] font-mono hover:bg-th-hover flex items-center gap-2 text-th-text-1"
          >
            {o.value === value && <span className="text-[10px]">✓</span>}
            <span className={o.value === value ? "" : "pl-[18px]"}>{o.label}</span>
          </button>
        ))}
      </FloatingMenu>
    </div>
  );
}
