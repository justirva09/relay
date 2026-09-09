import React, { useState, useEffect, useRef } from "react";

export function AddRequestDropdown({ title, onAddHttp, onAddGrpc, onImportGrpc, onAddFromCurl, className }: {
  title: string;
  onAddHttp: () => void;
  onAddGrpc: () => void;
  onImportGrpc: () => void;
  onAddFromCurl: () => void;
  className: string;
}) {
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

  return (
    <div ref={ref} className="relative">
      <button title={title} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className={className}>
        +
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[160px]">
          <button
            onClick={(e) => { e.stopPropagation(); onAddHttp(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            HTTP Request
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddGrpc(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            New gRPC Request
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onImportGrpc(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            Import gRPC API
          </button>
          <div className="my-1 border-t border-th-border" />
          <button
            onClick={(e) => { e.stopPropagation(); onAddFromCurl(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            From cURL
          </button>
        </div>
      )}
    </div>
  );
}
