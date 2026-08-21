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

// Set right before a drag-driven mouseup would fire a synthetic click on the
// same element, so onClick can skip it. Cleared next tick by the same drag
// handler. Exposed as accessors so Sidebar.tsx and TreeItem.tsx can share
// one instance without a circular import.
let suppressNextClick = false;
export function getSuppressNextClick(): boolean {
  return suppressNextClick;
}
export function setSuppressNextClick(value: boolean): void {
  suppressNextClick = value;
}
