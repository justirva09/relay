import ReactDOM from "react-dom";
import { VariableInfoEntry } from "../lib/useVariableHover";

const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

// pointer-events-none: must never be what the mouse is "over", or the
// hover lookup picks up the tooltip's own text instead of the token underneath
export default function VariableHoverTooltip({ x, y, name, info }: { x: number; y: number; name: string; info?: VariableInfoEntry }) {
  return ReactDOM.createPortal(
    <div
      style={{ position: "fixed", left: x + 14, top: y + 18, zIndex: 9999 }}
      className="pointer-events-none px-2.5 py-1.5 rounded-md bg-th-elevated border border-th-border shadow-xl text-[11.5px] font-mono max-w-[320px]"
    >
      {info ? (
        <>
          <div className="text-th-text-1 break-all">{info.value.trim() ? info.value : <span className="text-th-text-4 italic">(empty)</span>}</div>
          <div className="text-th-text-4 mt-0.5">from {info.label} · {MOD_KEY}-click to open</div>
        </>
      ) : (
        <div className="text-rose-300">"{name}" isn't defined in Global or any environment</div>
      )}
    </div>,
    document.body
  );
}
