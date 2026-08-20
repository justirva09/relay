import { useState } from "react";
import { RequestData } from "../../types";

function computeAutoHeaders(draft: RequestData): [string, string][] {
  const userHas = (name: string) => draft.headers.some((h) => h.enabled && h.key.trim().toLowerCase() === name);
  const rows: [string, string][] = [["Host", "<calculated when request is sent>"]];
  if (!userHas("user-agent")) rows.push(["User-Agent", "Relay/0.1.0"]);
  if (draft.bodyMode === "json" && !userHas("content-type")) rows.push(["Content-Type", "application/json"]);
  if (draft.bodyMode === "form-data" && !userHas("content-type")) rows.push(["Content-Type", "multipart/form-data; boundary=<calculated when request is sent>"]);
  if (draft.bodyMode === "urlencoded" && !userHas("content-type")) rows.push(["Content-Type", "application/x-www-form-urlencoded"]);
  if (draft.bodyMode !== "none") rows.push(["Content-Length", "<calculated when request is sent>"]);
  return rows;
}

export default function AutoHeadersList({ draft }: { draft: RequestData }) {
  const [show, setShow] = useState(false);
  const autoHeaders = computeAutoHeaders(draft);

  return (
    <div className="flex flex-col gap-1.5 mb-2">
      <button
        onClick={() => setShow((v) => !v)}
        className="self-start text-[11px] font-mono text-th-text-3 hover:text-th-accent-text"
      >
        {show ? "Hide" : "Show"} auto-generated headers ({autoHeaders.length})
      </button>
      {show && (
        <div className="flex flex-col gap-0.5 bg-th-bg border border-th-border rounded-md px-3 py-2">
          {autoHeaders.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-[12.5px] font-mono">
              <input type="checkbox" checked disabled className="accent-th-accent opacity-60" />
              <span className="text-th-text-3 w-[130px] shrink-0 truncate">{k}</span>
              <span className={`truncate ${v.startsWith("<") ? "text-th-text-4 italic" : "text-th-text-2"}`}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
