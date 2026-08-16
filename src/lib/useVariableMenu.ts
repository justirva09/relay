import { useCallback, useState } from "react";

export interface VarMenu {
  items: string[];
  activeIndex: number;
  replaceFrom: number;
  replaceTo: number;
  col: number;
}

// An unclosed "{{partial" ending at `pos` — a variable reference the user
// is in the middle of typing (no "}}" yet after the last "{{").
function unclosedVarAt(value: string, pos: number): { partial: string; replaceFrom: number } | null {
  const before = value.slice(0, pos);
  const match = /\{\{\s*([\w.-]*)$/.exec(before);
  if (!match) return null;
  return { partial: match[1], replaceFrom: pos - match[1].length };
}

// Shared {{variable}} completion trigger for single-line inputs (URL,
// header/param values) — CodeEditor has its own copy of this logic sized
// for a multi-line textarea, but the trigger itself is the same idea.
export function useVariableMenu(variables: string[] | undefined) {
  const [menu, setMenu] = useState<VarMenu | null>(null);

  const recompute = useCallback(
    (value: string, pos: number) => {
      if (!variables || !variables.length) {
        setMenu(null);
        return;
      }
      const v = unclosedVarAt(value, pos);
      if (!v) {
        setMenu(null);
        return;
      }
      const items = variables.filter((name) => name.toLowerCase().startsWith(v.partial.toLowerCase()));
      if (!items.length) {
        setMenu(null);
        return;
      }
      setMenu({ items, activeIndex: 0, replaceFrom: v.replaceFrom, replaceTo: pos, col: v.replaceFrom });
    },
    [variables]
  );

  const close = useCallback(() => setMenu(null), []);

  const move = useCallback((delta: number) => {
    setMenu((m) => (m ? { ...m, activeIndex: (m.activeIndex + delta + m.items.length) % m.items.length } : m));
  }, []);

  const hover = useCallback((index: number) => {
    setMenu((m) => (m ? { ...m, activeIndex: index } : m));
  }, []);

  // Returns the new value + cursor position after inserting `item` — caller
  // applies it to their own onChange/selection state.
  const apply = useCallback((currentValue: string, item: string) => {
    if (!menu) return null;
    const insertText = `${item}}}`;
    const next = currentValue.slice(0, menu.replaceFrom) + insertText + currentValue.slice(menu.replaceTo);
    const cursor = menu.replaceFrom + insertText.length;
    return { next, cursor };
  }, [menu]);

  return { menu, recompute, close, move, hover, apply };
}
