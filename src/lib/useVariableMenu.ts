import { useCallback, useState } from "react";

// A named source of variables — "Global" for workspace-level variables, or
// an environment's own name ("Local", "Staging", ...) — so the completion
// list can show which scope each suggestion comes from.
export interface VariableGroup {
  category: string;
  names: string[];
}

export interface VarItem {
  category: string;
  name: string;
}

export interface VarMenu {
  items: VarItem[];
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
export function useVariableMenu(groups: VariableGroup[] | undefined) {
  const [menu, setMenu] = useState<VarMenu | null>(null);

  const recompute = useCallback(
    (value: string, pos: number) => {
      if (!groups || !groups.length) {
        setMenu(null);
        return;
      }
      const v = unclosedVarAt(value, pos);
      if (!v) {
        setMenu(null);
        return;
      }
      const partial = v.partial.toLowerCase();
      const items: VarItem[] = [];
      for (const g of groups) {
        for (const name of g.names) {
          if (name.toLowerCase().startsWith(partial)) items.push({ category: g.category, name });
        }
      }
      if (!items.length) {
        setMenu(null);
        return;
      }
      setMenu({ items, activeIndex: 0, replaceFrom: v.replaceFrom, replaceTo: pos, col: v.replaceFrom });
    },
    [groups]
  );

  const close = useCallback(() => setMenu(null), []);

  const move = useCallback((delta: number) => {
    setMenu((m) => (m ? { ...m, activeIndex: (m.activeIndex + delta + m.items.length) % m.items.length } : m));
  }, []);

  const hover = useCallback((index: number) => {
    setMenu((m) => (m ? { ...m, activeIndex: index } : m));
  }, []);

  // Returns the new value + cursor position after inserting `name` — caller
  // applies it to their own onChange/selection state.
  const apply = useCallback((currentValue: string, name: string) => {
    if (!menu) return null;
    const insertText = `${name}}}`;
    const next = currentValue.slice(0, menu.replaceFrom) + insertText + currentValue.slice(menu.replaceTo);
    const cursor = menu.replaceFrom + insertText.length;
    return { next, cursor };
  }, [menu]);

  return { menu, recompute, close, move, hover, apply };
}
