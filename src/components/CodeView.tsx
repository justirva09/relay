import React, { useEffect, useMemo, useState } from "react";
import { highlightJS, highlightJSON, isJsonLike } from "../lib/highlight";

interface Props {
  value: string;
  className?: string;
}

function leadingSpaces(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

/// Bracket-matches `{`/`[` block openers to their closers on JSON.stringify(…, null, 2)
/// output. Every JSON string value stays on a single physical line, so checking the
/// last non-comma character of a trimmed line is enough to tell a block opener from
/// a leaf value — a string can never end a line with a bare `{`/`[`.
function computeFolds(lines: string[]): Map<number, number> {
  const starts: number[] = [];
  const folds = new Map<number, number>();
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    const withoutComma = trimmed.endsWith(",") ? trimmed.slice(0, -1) : trimmed;
    if (withoutComma.endsWith("{") || withoutComma.endsWith("[")) {
      starts.push(i);
      return;
    }
    if (trimmed === "}" || trimmed === "}," || trimmed === "]" || trimmed === "],") {
      const start = starts.pop();
      if (start !== undefined && i - start >= 2) folds.set(start, i);
    }
  });
  return folds;
}

function countDirectChildren(lines: string[], start: number, end: number): number {
  const childIndent = leadingSpaces(lines[start]) + 2;
  let count = 0;
  for (let i = start + 1; i < end; i++) {
    if (leadingSpaces(lines[i]) === childIndent) count++;
  }
  return count;
}

export default function CodeView({ value, className = "" }: Props) {
  const isJson = useMemo(() => isJsonLike(value), [value]);
  const lines = useMemo(() => value.split("\n"), [value]);
  const folds = useMemo(() => (isJson ? computeFolds(lines) : new Map<number, number>()), [isJson, lines]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  useEffect(() => {
    setCollapsed(new Set());
  }, [value]);

  const htmlLines = useMemo(() => {
    const highlighted = isJson ? highlightJSON(value) : highlightJS(value);
    return highlighted.replace(/\n$/, "").split("\n");
  }, [isJson, value]);

  const gutterWidth = Math.max(2, String(lines.length).length) + 5;

  const toggle = (i: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const rows: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const lineIndex = i;
    const foldEnd = folds.get(lineIndex);
    const isFoldStart = foldEnd !== undefined;
    const isCollapsed = isFoldStart && collapsed.has(lineIndex);

    let lineHtml = htmlLines[lineIndex] ?? "";
    if (isCollapsed && foldEnd !== undefined) {
      const openChar = lines[lineIndex].trim().replace(/,$/, "").slice(-1);
      const closeChar = openChar === "{" ? "}" : "]";
      const closeHasComma = lines[foldEnd].trim().endsWith(",");
      const count = countDirectChildren(lines, lineIndex, foldEnd);
      const noun = openChar === "{" ? (count === 1 ? "key" : "keys") : count === 1 ? "item" : "items";
      lineHtml += `<span class="text-th-text-4 text-[11px] mx-1">${count} ${noun}</span><span class="text-th-text-3">${closeChar}${closeHasComma ? "," : ""}</span>`;
    }

    rows.push(
      <div key={lineIndex} className="flex">
        <div
          className="shrink-0 select-none flex items-center text-[12.5px] font-mono leading-[1.6] text-th-text-4 border-r border-th-border bg-th-bg/40"
          style={{ width: `${gutterWidth}ch` }}
        >
          <button
            onClick={() => isFoldStart && toggle(lineIndex)}
            className={`w-5 shrink-0 flex items-center justify-center ${
              isFoldStart ? "text-th-text-3 hover:text-th-accent-text cursor-pointer" : ""
            }`}
          >
            {isFoldStart ? (isCollapsed ? "▶" : "▼") : ""}
          </button>
          <span className="flex-1 text-right pr-3">{lineIndex + 1}</span>
        </div>
        <div
          className="flex-1 min-w-0 px-3 text-[12.5px] font-mono leading-[1.6] text-th-text-1 whitespace-pre select-text"
          dangerouslySetInnerHTML={{ __html: lineHtml }}
        />
      </div>
    );

    i = isCollapsed && foldEnd !== undefined ? foldEnd + 1 : lineIndex + 1;
  }

  return <div className={`overflow-auto py-2 ${className}`}>{rows}</div>;
}
