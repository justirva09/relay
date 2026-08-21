import { DiffCategory } from "./apiDiff";

export const ALL_CATEGORIES: DiffCategory[] = ["method", "url", "auth", "query", "header", "body"];

// url embeds the query string, so "url changed" and "query changed" aren't
// independent at the string level. Splitting here lets a partial merge
// recombine the right base with the right query instead of picking one
// whole url value and dropping the other category's change.
function splitUrl(url: string): { base: string; query: string } {
  const qIndex = url.indexOf("?");
  return qIndex === -1 ? { base: url, query: "" } : { base: url.slice(0, qIndex), query: url.slice(qIndex) };
}

// Builds file content for a commit that captures only the selected
// categories. Everything else keeps its before value so it stays a pending
// unstaged change instead of getting swept in silently.
//
// Fields outside the 6 categories (description, scripts) never move unless
// every category is selected, in which case the whole file goes through
// as-is. Keeps "select all" meaning exactly that.
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
  categories: DiffCategory[]; // "modified" only, which categories are being committed
}

// Just a starting point, not a final answer. Names the requests touched and
// which categories are actually staged for this commit.
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
