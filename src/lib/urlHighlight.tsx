import React from "react";
import { VariableGroup } from "./useVariableMenu";

const TOKEN_RE = /(\{\{[^}]*\}\})|(:[A-Za-z_]\w*)/g;

// Undefined-anywhere check: not in Global and not in any environment. When
// `variableGroups` isn't passed at all, callers haven't opted into this
// check (e.g. no workspace context yet) — never flag in that case, since
// "unknown" isn't the same claim as "confirmed undefined".
function isKnownVariable(name: string, variableGroups?: VariableGroup[]): boolean {
  if (!variableGroups) return true;
  return variableGroups.some((g) => g.names.includes(name));
}

// Highlights {{variable}} references (anywhere) and, when `pathParams` is
// true, Postman-style :paramName path segments — scoped to the part of the
// URL before the first "?", so a stray ":" inside a query value (or a port
// number like "localhost:8087") never gets mistaken for a path param. When
// `variableGroups` is supplied, a `{{variable}}` that doesn't resolve in
// ANY scope (Global or any environment) renders flagged — visible at a
// glance, no hover needed.
export function highlightUrlTokens(text: string, pathParams: boolean, variableGroups?: VariableGroup[]): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const qIndex = text.indexOf("?");
  const pathEnd = qIndex === -1 ? text.length : qIndex;
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const isPathParam = match[2] !== undefined;
    if (isPathParam && (!pathParams || match.index >= pathEnd)) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    let className = isPathParam ? "text-sky-400" : "text-orange-400";
    // data-var carries the variable name for the hover/click layer
    // (useVariableHover.ts) to read back — this span sits under a
    // pointer-events-none overlay (see UrlInput/ValueInput), so it can
    // never receive real hover/click events itself; the name is looked up
    // geometrically via caretRangeFromPoint instead.
    let dataVar: string | undefined;
    if (!isPathParam) {
      const name = match[0].slice(2, -2).trim();
      dataVar = name;
      if (!isKnownVariable(name, variableGroups)) {
        className = "text-rose-400 underline decoration-dotted decoration-rose-400/70 underline-offset-2";
      }
    }
    parts.push(
      <span key={match.index} className={className} data-var={dataVar}>
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 0) parts.push(" ");
  return parts;
}
