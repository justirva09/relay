import { DiffCategory } from "./apiDiff";

export const ALL_CATEGORIES: DiffCategory[] = ["method", "url", "auth", "query", "header", "body"];

// RequestData.url is the single source of truth string — it EMBEDS the
// query string (params is just a parsed KVRow view kept in sync with it,
// see RequestPanel's handleParamsChange), so "url changed" and "query
// changed" aren't actually independent at the string level. Splitting here
// lets a partial merge recombine the right base path with the right query
// string instead of picking one whole `url` value and silently dropping
// the other category's change to it.
function splitUrl(url: string): { base: string; query: string } {
  const qIndex = url.indexOf("?");
  return qIndex === -1 ? { base: url, query: "" } : { base: url.slice(0, qIndex), query: url.slice(qIndex) };
}

// Builds the exact file content that should be written to disk (then
// git-added) so a commit captures only the selected categories from a
// modified request — everything else keeps its last-commit ("before")
// value, so it stays a pending unstaged change for a later commit instead
// of getting swept in silently.
//
// Fields outside the 6 selectable categories (description, pre/test
// scripts) are NEVER touched by a partial selection — they only move when
// every category is selected, in which case the whole current file is used
// as-is (byte-identical, nothing held back). This keeps the "select all"
// checkbox's meaning literal: it's the only path that can ever carry an
// edit this feature has no checkbox for.
export function mergeSelectedRequestFields(beforeFull: any, afterFull: any, selected: Set<DiffCategory>): any {
  const allSelected = ALL_CATEGORIES.every((c) => selected.has(c));
  if (allSelected) return afterFull;

  const beforeReq = beforeFull.request;
  const afterReq = afterFull.request;

  const beforeUrl = splitUrl(beforeReq.url);
  const afterUrl = splitUrl(afterReq.url);
  const mergedUrl = (selected.has("url") ? afterUrl.base : beforeUrl.base) + (selected.has("query") ? afterUrl.query : beforeUrl.query);

  const merged = {
    ...beforeReq,
    ...(selected.has("method") ? { method: afterReq.method } : {}),
    url: mergedUrl,
    ...(selected.has("url") ? { pathParams: afterReq.pathParams } : {}),
    ...(selected.has("auth") ? { auth: afterReq.auth } : {}),
    ...(selected.has("query") ? { params: afterReq.params } : {}),
    ...(selected.has("header") ? { headers: afterReq.headers } : {}),
    ...(selected.has("body")
      ? { bodyMode: afterReq.bodyMode, bodyText: afterReq.bodyText, bodyForm: afterReq.bodyForm, bodyUrlencoded: afterReq.bodyUrlencoded }
      : {}),
  };

  return { ...beforeFull, request: merged };
}

const CATEGORY_LABEL: Record<DiffCategory, string> = {
  method: "method",
  url: "url",
  auth: "auth",
  query: "query params",
  header: "headers",
  body: "body",
};

export interface StagedEntrySummary {
  status: "added" | "removed" | "modified";
  name: string;
  categories: DiffCategory[]; // for "modified" only — which categories are actually being committed
}

// A starting point for the commit message, not a final answer — names the
// requests touched and, for modified ones, which categories were actually
// staged (not just "changed" — only what THIS commit is picking up).
export function suggestCommitMessage(entries: StagedEntrySummary[]): string {
  if (!entries.length) return "";

  const added = entries.filter((e) => e.status === "added");
  const removed = entries.filter((e) => e.status === "removed");
  const modified = entries.filter((e) => e.status === "modified");

  const parts: string[] = [];
  if (added.length) parts.push(`add ${added.map((e) => e.name).join(", ")}`);
  if (removed.length) parts.push(`remove ${removed.map((e) => e.name).join(", ")}`);
  if (modified.length) {
    const categoryLabels = Array.from(new Set(modified.flatMap((e) => e.categories))).map((c) => CATEGORY_LABEL[c]);
    const what = categoryLabels.length ? categoryLabels.join("/") : "requests";
    parts.push(`update ${what} for ${modified.map((e) => e.name).join(", ")}`);
  }

  return parts.join("; ");
}
