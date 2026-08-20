export const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-rose-400",
  HEAD: "text-slate-400",
  OPTIONS: "text-slate-400",
};

export interface DropInfo {
  id: string;
  position: "before" | "after" | "inside";
}

// Set right before a drag-driven mouseup would otherwise fire a synthetic
// click on the same element, so TreeItem's onClick can skip acting on it —
// cleared on the next tick by the same drag handler that set it. Exposed as
// accessors (not a bare exported `let`) so Sidebar.tsx and TreeItem.tsx can
// share one instance without a circular import between them.
let suppressNextClick = false;
export function getSuppressNextClick(): boolean {
  return suppressNextClick;
}
export function setSuppressNextClick(value: boolean): void {
  suppressNextClick = value;
}
