import React, { useRef, useCallback, useMemo } from "react";
import { highlightJS, highlightJSON, isJsonLike, escapeHtml } from "../lib/highlight";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export default function CodeEditor({ value, onChange, placeholder, className = "" }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const syncScroll = useCallback(() => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const next = val.substring(0, start) + "  " + val.substring(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [onChange]);

  const lineCount = useMemo(() => Math.max(1, (value.match(/\n/g)?.length ?? 0) + 1), [value]);
  const gutterWidth = Math.max(2, String(lineCount).length);

  const highlighted = value
    ? (isJsonLike(value) ? highlightJSON(value) : highlightJS(value))
    : `<span class="text-th-text-4">${escapeHtml(placeholder || "")}</span>`;

  return (
    <div className={`relative flex ${className}`}>
      <div
        ref={gutterRef}
        aria-hidden
        className="shrink-0 overflow-hidden select-none text-right px-2 py-2 text-[12.5px] font-mono leading-[1.6] text-th-text-4 border-r border-th-border bg-th-bg/40"
        style={{ width: `${gutterWidth + 1.5}ch` }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="relative flex-1 min-w-0">
        <pre
          ref={preRef}
          aria-hidden
          className="absolute inset-0 overflow-auto px-3 py-2 text-[12.5px] font-mono leading-[1.6] text-th-text-1 whitespace-pre pointer-events-none"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="absolute inset-0 w-full h-full resize-none bg-transparent text-transparent caret-th-text-1 px-3 py-2 text-[12.5px] font-mono leading-[1.6] whitespace-pre overflow-auto focus:outline-none"
          style={{ caretColor: "var(--c-text-1)" }}
        />
      </div>
    </div>
  );
}
