import React, { useRef, useCallback, useEffect, useMemo, useState } from "react";
import { highlightJS, highlightJSON, isJsonLike, escapeHtml } from "../lib/highlight";
import { CompletionItem, ASSERTION_ROOT } from "../lib/pmCompletions";
import { ProtoFieldSchema } from "../lib/grpcClient";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  completions?: CompletionItem[];
  variables?: string[];
  protoFields?: ProtoFieldSchema[];
}

interface Suggestion {
  label: string;
  detail: string;
  isMethod?: boolean;
  hasArgs?: boolean;
}

interface Menu {
  kind: "pm" | "variable" | "proto";
  items: Suggestion[];
  activeIndex: number;
  replaceFrom: number;
  replaceTo: number;
  line: number;
  col: number;
}

const LINE_HEIGHT_PX = 20; // text-[12.5px] * leading-[1.6]

const AUTO_PAIRS: Record<string, string> = { "{": "}", "[": "]", "(": ")", '"': '"', "'": "'", "`": "`" };
const CLOSERS = new Set(Object.values(AUTO_PAIRS));

// True when `opener` is a real pair-opening char (not undefined, e.g. at the
// document's start/end) whose closer is exactly `closer`.
function isPairAt(opener: string | undefined, closer: string | undefined): boolean {
  return opener !== undefined && Object.prototype.hasOwnProperty.call(AUTO_PAIRS, opener) && AUTO_PAIRS[opener] === closer;
}

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

// An unclosed JSON key string being typed right after "{" or "," — e.g. `{"na`
// or `, "na`. Doesn't fire once the closing quote exists.
function unclosedJsonKeyAt(value: string, pos: number): { partial: string; replaceFrom: number; keyStart: number } | null {
  const before = value.slice(0, pos);
  const match = /[{,]\s*"(\w*)$/.exec(before);
  if (!match) return null;
  return { partial: match[1], replaceFrom: pos - match[1].length, keyStart: match.index };
}

// Walks `value` up to `boundary` tracking brace/bracket nesting, giving both
// the chain of field names containing the cursor (e.g. ["tree", "children"])
// and the keys already used in that same, still-open object — so a field
// already filled in above isn't suggested again. Best-effort: ignores content
// once it hits truly malformed JSON rather than throwing, since the document
// is usually mid-edit.
function jsonContextAt(value: string, boundary: number): { path: string[]; siblingKeys: Set<string> } {
  const pathStack: string[] = [];
  const keysStack: Set<string>[] = [new Set()];
  let lastKey: string | null = null;
  let i = 0;
  while (i < boundary) {
    const ch = value[i];
    if (ch === '"') {
      let j = i + 1;
      let str = "";
      while (j < boundary && value[j] !== '"') {
        if (value[j] === "\\") { str += value[j + 1] ?? ""; j += 2; continue; }
        str += value[j];
        j++;
      }
      if (value[j] !== '"') break; // unterminated string at the boundary — stop
      let k = j + 1;
      while (k < boundary && /\s/.test(value[k])) k++;
      if (value[k] === ":") {
        lastKey = str;
        keysStack[keysStack.length - 1].add(str);
      }
      i = j + 1;
      continue;
    }
    if (ch === "{" || ch === "[") {
      pathStack.push(lastKey ?? "");
      keysStack.push(new Set());
      lastKey = null;
    } else if (ch === "}" || ch === "]") {
      pathStack.pop();
      if (keysStack.length > 1) keysStack.pop();
    }
    i++;
  }
  return { path: pathStack.filter((s) => s !== ""), siblingKeys: keysStack[keysStack.length - 1] };
}

function protoKindLabel(f: ProtoFieldSchema): string {
  return f.kind + (f.repeated ? "[]" : "");
}

function resolveProtoCompletions(path: string[], siblingKeys: Set<string>, partial: string, root: ProtoFieldSchema[]): Suggestion[] {
  let siblings = root;
  for (const seg of path) {
    const node = siblings.find((f) => f.name === seg);
    if (!node || !node.fields) return [];
    siblings = node.fields;
  }
  const lower = partial.toLowerCase();
  return siblings
    .filter((f) => f.name.toLowerCase().startsWith(lower) && !siblingKeys.has(f.name))
    .map((f) => ({ label: f.name, detail: protoKindLabel(f) }));
}

interface HistoryEntry {
  value: string;
  start: number;
  end: number;
}

const UNDO_COALESCE_MS = 500;

export default function CodeEditor({ value, onChange, placeholder, className = "", completions, variables, protoFields }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  // Once we start manually rewriting `value` for auto-pairing/auto-indent
  // (preventDefault + a programmatic value change), the browser's native
  // undo stack for the textarea no longer tracks those edits reliably — so
  // undo/redo is reimplemented here instead of relying on it.
  const historyRef = useRef<HistoryEntry[]>([{ value, start: value.length, end: value.length }]);
  const historyIndexRef = useRef(0);
  const lastEditAtRef = useRef(0);
  const isInternalChangeRef = useRef(false);

  // `value` changing without us having triggered it (switching tabs, a
  // Prettify button, an auto-filled template, …) starts a fresh undo baseline
  // instead of being folded into whatever history already existed.
  useEffect(() => {
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      return;
    }
    historyRef.current = [{ value, start: value.length, end: value.length }];
    historyIndexRef.current = 0;
  }, [value]);

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
      if (protoFields && protoFields.length) {
        const key = unclosedJsonKeyAt(val, pos);
        if (key) {
          const { path, siblingKeys } = jsonContextAt(val, key.keyStart + 1);
          const items = resolveProtoCompletions(path, siblingKeys, key.partial, protoFields);
          if (items.length) {
            setMenu(buildMenu(val, "proto", items, key.replaceFrom, pos));
            return;
          }
        }
      }
      setMenu(null);
    },
    [completions, variables, protoFields, buildMenu]
  );

  // Records + applies an edit in one step, coalescing consecutive plain typing
  // into a single undo step (like a real editor) while structural edits
  // (brackets, Enter, completions, …) each get their own step.
  const commitEdit = useCallback(
    (next: string, start: number, end: number, opts: { coalesce: boolean }) => {
      const now = Date.now();
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      const top = historyRef.current[historyRef.current.length - 1];
      const canCoalesce =
        opts.coalesce && !!top && now - lastEditAtRef.current < UNDO_COALESCE_MS && Math.abs(next.length - top.value.length) <= 1;
      if (canCoalesce) {
        historyRef.current[historyRef.current.length - 1] = { value: next, start, end };
      } else {
        historyRef.current.push({ value: next, start, end });
        historyIndexRef.current++;
      }
      lastEditAtRef.current = now;

      isInternalChangeRef.current = true;
      onChange(next);
      recomputeMenu(next, end);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.selectionStart = start;
        textareaRef.current.selectionEnd = end;
      });
    },
    [onChange, recomputeMenu]
  );

  const applyHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      isInternalChangeRef.current = true;
      onChange(entry.value);
      recomputeMenu(entry.value, entry.end);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.selectionStart = entry.start;
        textareaRef.current.selectionEnd = entry.end;
      });
    },
    [onChange, recomputeMenu]
  );

  const undo = useCallback(() => {
    if (historyIndexRef.current === 0) return;
    historyIndexRef.current--;
    applyHistoryEntry(historyRef.current[historyIndexRef.current]);
  }, [applyHistoryEntry]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    applyHistoryEntry(historyRef.current[historyIndexRef.current]);
  }, [applyHistoryEntry]);

  const insertCompletion = useCallback(
    (item: Suggestion) => {
      if (!menu || !textareaRef.current) return;
      let replaceTo = menu.replaceTo;
      const insertText =
        menu.kind === "variable"
          ? `${item.label}}}`
          : menu.kind === "proto"
          ? `${item.label}": `
          : item.label + (item.isMethod ? "()" : "");
      // Completing a JSON key: the key's own auto-inserted closing quote is
      // still sitting right after the cursor — consume it too, since our
      // insertText already supplies the closing `"` (otherwise it's left
      // behind as a stray `"` right after the value position).
      if (menu.kind === "proto" && value[replaceTo] === '"') replaceTo += 1;
      const next = value.slice(0, menu.replaceFrom) + insertText + value.slice(replaceTo);
      const cursor =
        menu.kind === "variable" || menu.kind === "proto"
          ? menu.replaceFrom + insertText.length
          : menu.replaceFrom + item.label.length + (item.isMethod ? (item.hasArgs ? 1 : 2) : 0);
      commitEdit(next, cursor, cursor, { coalesce: false });
      setMenu(null);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [menu, value, commitEdit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const ta = e.target;
      commitEdit(ta.value, ta.selectionStart, ta.selectionEnd, { coalesce: true });
    },
    [commitEdit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setMenu(null);
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setMenu(null);
        redo();
        return;
      }
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
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;

      if (e.key === "Tab") {
        e.preventDefault();
        commitEdit(val.slice(0, start) + "  " + val.slice(end), start + 2, start + 2, { coalesce: false });
        return;
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        // Typing a closer that's already right there just steps over it,
        // instead of inserting a duplicate — e.g. `{|}` + `}` → `{}|`.
        if (start === end && CLOSERS.has(e.key) && val[start] === e.key) {
          e.preventDefault();
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start + 1;
          });
          return;
        }

        if (Object.prototype.hasOwnProperty.call(AUTO_PAIRS, e.key)) {
          e.preventDefault();
          const closer = AUTO_PAIRS[e.key];
          if (start !== end) {
            const selected = val.slice(start, end);
            commitEdit(val.slice(0, start) + e.key + selected + closer + val.slice(end), start + 1, start + 1 + selected.length, { coalesce: false });
          } else {
            commitEdit(val.slice(0, start) + e.key + closer + val.slice(end), start + 1, start + 1, { coalesce: false });
          }
          return;
        }

        // Backspacing right inside an empty auto-inserted pair removes both at once.
        if (e.key === "Backspace" && start === end && start > 0 && isPairAt(val[start - 1], val[start])) {
          e.preventDefault();
          commitEdit(val.slice(0, start - 1) + val.slice(start + 1), start - 1, start - 1, { coalesce: false });
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          const lineStart = val.lastIndexOf("\n", start - 1) + 1;
          const indent = /^[ \t]*/.exec(val.slice(lineStart, start))![0];
          if (isPairAt(val[start - 1], val[start])) {
            // Enter between a fresh, empty pair expands to three lines with the
            // closer re-aligned under the opener — e.g. `{|}` → `{\n  |\n}`.
            const inserted = `\n${indent}  \n${indent}`;
            const cursor = start + indent.length + 3;
            commitEdit(val.slice(0, start) + inserted + val.slice(end), cursor, cursor, { coalesce: false });
          } else {
            const cursor = start + 1 + indent.length;
            commitEdit(val.slice(0, start) + "\n" + indent + val.slice(end), cursor, cursor, { coalesce: false });
          }
        }
      }
    },
    [menu, insertCompletion, commitEdit, undo, redo]
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
