import { Method } from "../../types";

export const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const METHOD_COLOR: Record<string, { text: string; bg: string; ring: string }> = {
  GET: { text: "text-emerald-400", bg: "bg-emerald-400/10", ring: "ring-emerald-400/30" },
  POST: { text: "text-sky-400", bg: "bg-sky-400/10", ring: "ring-sky-400/30" },
  PUT: { text: "text-amber-400", bg: "bg-amber-400/10", ring: "ring-amber-400/30" },
  PATCH: { text: "text-violet-400", bg: "bg-violet-400/10", ring: "ring-violet-400/30" },
  DELETE: { text: "text-rose-400", bg: "bg-rose-400/10", ring: "ring-rose-400/30" },
  HEAD: { text: "text-slate-400", bg: "bg-slate-400/10", ring: "ring-slate-400/30" },
  OPTIONS: { text: "text-slate-400", bg: "bg-slate-400/10", ring: "ring-slate-400/30" },
};

export const METHOD_TEXT: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-rose-400",
  HEAD: "text-slate-400",
  OPTIONS: "text-slate-400",
};
