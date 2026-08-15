import React, { useState } from "react";

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center w-[14px] h-[14px] text-[9px] text-th-text-4 hover:text-th-text-1 select-none shrink-0"
    >
      {open ? "▼" : "▶"}
    </button>
  );
}

function JsonValue({ value, isLast }: { value: string | number | boolean | null; isLast: boolean }) {
  let cls = "text-th-text-1";
  let display: string;
  if (value === null) {
    cls = "text-th-syn-null";
    display = "null";
  } else if (typeof value === "boolean") {
    cls = "text-th-syn-bool";
    display = String(value);
  } else if (typeof value === "number") {
    cls = "text-th-syn-number";
    display = String(value);
  } else {
    cls = "text-th-syn-string";
    display = JSON.stringify(value);
  }
  return (
    <>
      <span className={cls}>{display}</span>
      {!isLast && <span className="text-th-text-3">,</span>}
    </>
  );
}

function JsonNode({ data, name, isLast, depth }: { data: any; name?: string; isLast: boolean; depth: number }) {
  const [open, setOpen] = useState(true);
  const indent = depth * 16;

  const nameEl = name !== undefined ? (
    <>
      <span className="text-th-syn-key">{JSON.stringify(name)}</span>
      <span className="text-th-text-3">: </span>
    </>
  ) : null;

  if (data === null || typeof data !== "object") {
    return (
      <div className="leading-[22px]" style={{ paddingLeft: indent }}>
        {nameEl}
        <JsonValue value={data} isLast={isLast} />
      </div>
    );
  }

  const isArray = Array.isArray(data);
  const entries = isArray ? data : Object.keys(data);
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";
  const count = entries.length;

  if (count === 0) {
    return (
      <div className="leading-[22px]" style={{ paddingLeft: indent }}>
        {nameEl}
        <span className="text-th-text-3">{bracketOpen}{bracketClose}</span>
        {!isLast && <span className="text-th-text-3">,</span>}
      </div>
    );
  }

  return (
    <div>
      <div className="leading-[22px]" style={{ paddingLeft: indent }}>
        <Toggle open={open} onClick={() => setOpen((o) => !o)} />
        {nameEl}
        <span className="text-th-text-3">{bracketOpen}</span>
        {!open && (
          <>
            <span className="text-th-text-4 text-[11px] mx-1">{count} {isArray ? (count === 1 ? "item" : "items") : (count === 1 ? "key" : "keys")}</span>
            <span className="text-th-text-3">{bracketClose}</span>
            {!isLast && <span className="text-th-text-3">,</span>}
          </>
        )}
      </div>
      {open && (
        <>
          {isArray
            ? data.map((item: any, i: number) => (
                <JsonNode key={i} data={item} isLast={i === data.length - 1} depth={depth + 1} />
              ))
            : Object.keys(data).map((key, i) => (
                <JsonNode key={key} data={data[key]} name={key} isLast={i === entries.length - 1} depth={depth + 1} />
              ))}
          <div className="leading-[22px]" style={{ paddingLeft: indent }}>
            <span className="text-th-text-3">{bracketClose}</span>
            {!isLast && <span className="text-th-text-3">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function isJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

export function JsonTree({ text }: { text: string }) {
  try {
    const parsed = JSON.parse(text);
    return (
      <div className="text-[12.5px] font-mono leading-relaxed">
        <JsonNode data={parsed} isLast depth={0} />
      </div>
    );
  } catch {
    return <span className="text-th-text-1">{text}</span>;
  }
}
