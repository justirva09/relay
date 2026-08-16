import React, { useRef, useCallback, useMemo, useState } from "react";
import { highlightJS, highlightJSON, isJsonLike, escapeHtml } from "../lib/highlight";
import { CompletionItem, ASSERTION_ROOT } from "../lib/pmCompletions";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  completions?: CompletionItem[];
  variables?: string[];
}

interface Suggestion {
  label: string;
  detail: string;
  isMethod?: boolean;
  hasArgs?: boolean;
}

interface Menu {
  kind: "pm" | "variable";
  items: Suggestion[];
  activeIndex: number;
  replaceFrom: number;
  replaceTo: number;
  line: number;
  col: number;
}

const LINE_HEIGHT_PX = 20; // text-[12.5px] * leading-[1.6]

// Extracts the dot-chain ending at `pos` (e.g. "pm.re" or "to.be.a"), splits
// it into the path already typed and the partial word being completed.
function chainAt(value: string, pos: number): { path: string[]; partial: string; replaceFrom: number } | null {
  const before = value.slice(0, pos);
  const match = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/.exec(before);
  if (!match) return null;
  const parts = match[0].split(".");
  const partial = parts[parts.length - 1];
  const path = parts.slice(0, -1);
  if (path.length === 0) return null; // need at least "pm." or "to." typed
  return { path, partial, replaceFrom: pos - partial.length };
}

function resolvePmCompletions(path: string[], partial: string, pmRoot: CompletionItem[]): Suggestion[] {
  const [head, ...rest] = path;
  let node: CompletionItem | undefined;
  let siblings: CompletionItem[];
  if (head === "pm") {
    siblings = pmRoot;
  } else if (head === "to") {
    siblings = ASSERTION_ROOT.children!;
  } else {
    return [];
  }
  for (const seg of rest) {
    node = siblings.find((c) => c.label === seg);
    if (!node || !node.children) return [];
    siblings = node.children;
  }
  return siblings.filter((c) => c.label.startsWith(partial));
}

// An unclosed "{{partial" ending at `pos` — i.e. a variable reference the
// user is in the middle of typing (no "}}" yet after the last "{{").
function unclosedVarAt(value: string, pos: number): { partial: string; replaceFrom: number } | null {
  const before = value.slice(0, pos);
  const match = /\{\{\s*([\w.-]*)$/.exec(before);
  if (!match) return null;
  return { partial: match[1], replaceFrom: pos - match[1].length };
}

export default function CodeEditor({ value, onChange, placeholder, className = "", completions, variables }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

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

  const buildMenu = useCallback(
    (val: string, kind: Menu["kind"], items: Suggestion[], replaceFrom: number, replaceTo: number): Menu => {
      const before = val.slice(0, replaceFrom);
      const lines = before.split("\n");
      return {
        kind,
        items,
        activeIndex: 0,
        replaceFrom,
        replaceTo,
        line: lines.length - 1,
        col: lines[lines.length - 1].length,
      };
    },
    []
  );

  const recomputeMenu = useCallback(
    (val: string, pos: number) => {
      if (variables && variables.length) {
        const v = unclosedVarAt(val, pos);
        if (v) {
          const items = variables
            .filter((name) => name.toLowerCase().startsWith(v.partial.toLowerCase()))
            .map((name) => ({ label: name, detail: "variable" }));
          if (items.length) {
            setMenu(buildMenu(val, "variable", items, v.replaceFrom, pos));
            return;
          }
          setMenu(null);
          return;
        }
      }
      if (completions) {
        const chain = chainAt(val, pos);
        if (chain) {
          const items = resolvePmCompletions(chain.path, chain.partial, completions);
          if (items.length) {
            setMenu(buildMenu(val, "pm", items, chain.replaceFrom, pos));
            return;
          }
        }
      }
      setMenu(null);
    },
    [completions, variables, buildMenu]
  );

  const insertCompletion = useCallback(
    (item: Suggestion) => {
      if (!menu || !textareaRef.current) return;
      const isVariable = menu.kind === "variable";
      const insertText = isVariable ? `${item.label}}}` : item.label + (item.isMethod ? "()" : "");
      const next = value.slice(0, menu.replaceFrom) + insertText + value.slice(menu.replaceTo);
      const cursor = isVariable
        ? menu.replaceFrom + insertText.length
        : menu.replaceFrom + item.label.length + (item.isMethod ? (item.hasArgs ? 1 : 2) : 0);
      onChange(next);
      setMenu(null);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cursor;
      });
    },
    [menu, value, onChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const ta = e.target;
      onChange(ta.value);
      recomputeMenu(ta.value, ta.selectionStart);
    },
    [onChange, recomputeMenu]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (menu) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMenu((m) => (m ? { ...m, activeIndex: (m.activeIndex + 1) % m.items.length } : m));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMenu((m) => (m ? { ...m, activeIndex: (m.activeIndex - 1 + m.items.length) % m.items.length } : m));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertCompletion(menu.items[menu.activeIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMenu(null);
          return;
        }
      }
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
    },
    [onChange, menu, insertCompletion]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // ArrowUp/Down are consumed by menu navigation in handleKeyDown (which
      // calls preventDefault, so the caret never actually moves) — recomputing
      // here too would reset activeIndex back to 0 on every press, making the
      // menu look stuck. Only recompute for keys that genuinely move the caret.
      if (menu && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
        const ta = e.currentTarget;
        recomputeMenu(ta.value, ta.selectionStart);
      }
    },
    [recomputeMenu, menu]
  );

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
          onChange={handleChange}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onClick={(e) => { const ta = e.currentTarget; recomputeMenu(ta.value, ta.selectionStart); }}
          onBlur={() => setMenu(null)}
          spellCheck={false}
          className="absolute inset-0 w-full h-full resize-none bg-transparent text-transparent caret-th-text-1 px-3 py-2 text-[12.5px] font-mono leading-[1.6] whitespace-pre overflow-auto focus:outline-none"
          style={{ caretColor: "var(--c-text-1)" }}
        />
        {menu && (
          <div
            className="absolute z-50 min-w-[180px] max-w-[280px] bg-th-elevated border border-th-border rounded-md shadow-xl py-1 font-mono text-[12px] overflow-hidden"
            style={{
              left: `calc(${menu.col}ch + 0.75rem - ${textareaRef.current?.scrollLeft ?? 0}px)`,
              top: `calc(${(menu.line + 1) * LINE_HEIGHT_PX}px + 0.5rem - ${textareaRef.current?.scrollTop ?? 0}px)`,
            }}
          >
            {menu.items.map((item, i) => (
              <button
                key={item.label}
                onMouseDown={(e) => { e.preventDefault(); insertCompletion(item); }}
                onMouseEnter={() => setMenu((m) => (m ? { ...m, activeIndex: i } : m))}
                className={`w-full flex items-center justify-between gap-3 px-2.5 py-1 text-left ${
                  i === menu.activeIndex ? "bg-th-hover" : ""
                }`}
              >
                <span className="text-th-text-1 truncate">
                  {item.label}
                  {item.isMethod && <span className="text-th-text-4">()</span>}
                </span>
                <span className="text-th-text-4 truncate shrink-0 max-w-[120px]">{item.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
