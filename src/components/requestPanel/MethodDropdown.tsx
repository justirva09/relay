import { useEffect, useRef, useState } from "react";
import { Method } from "../../types";
import { METHODS, METHOD_COLOR, METHOD_TEXT } from "./shared";

export default function MethodDropdown({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const color = METHOD_COLOR[value] || METHOD_COLOR.GET;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`font-mono text-[13px] font-semibold px-2.5 py-2 rounded-md ring-1 border border-transparent cursor-pointer flex items-center gap-1.5 ${color.text} ${color.bg} ${color.ring}`}
      >
        {value}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="opacity-60">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[120px]">
          {METHODS.map((m) => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-[13px] font-mono font-semibold hover:bg-th-hover flex items-center gap-2 ${METHOD_TEXT[m]}`}
            >
              {value === m && <span className="text-[10px]">✓</span>}
              <span className={value === m ? "" : "pl-[18px]"}>{m}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
