import React, { useRef, useState } from "react";
import ReactDOM from "react-dom";

// Small hover-triggered explainer — used wherever a label alone doesn't say
// enough (Performance cards, Path Variables, ...) instead of the browser's
// plain native title tooltip, to match the app's own visual language.
// Portaled straight to <body> at a computed fixed position (same technique
// as VariableHoverTooltip) rather than position:absolute in place, since
// callers often sit inside an overflow-y-auto container that would
// otherwise clip the tooltip regardless of z-index.
export default function InfoTooltip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const iconRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    const r = iconRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
  };

  return (
    <span
      ref={iconRef}
      className="relative shrink-0 h-3.5 w-3.5 grid place-items-center rounded-full border border-th-border text-th-text-4 text-[9px] font-semibold cursor-help select-none"
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      ?
      {pos &&
        ReactDOM.createPortal(
          <div
            style={{ position: "fixed", left: pos.x, top: pos.y - 8, transform: "translate(-50%, -100%)" }}
            className="z-50 w-52 px-2.5 py-1.5 rounded-md bg-th-elevated border border-th-border shadow-xl text-[11px] text-th-text-2 leading-relaxed pointer-events-none"
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}
