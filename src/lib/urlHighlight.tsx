import React from "react";
import { VariableGroup } from "./useVariableMenu";

const TOKEN_RE = /(\{\{[^}]*\}\})|(:[A-Za-z_]\w*)/g;

// Checks the variable exists in Global or any environment. If variableGroups
// isn't passed at all, the caller hasn't opted into this check, so never
// flag: "unknown" isn't the same as "confirmed undefined".
function isKnownVariable(name: string, variableGroups?: VariableGroup[]): boolean {
  if (!variableGroups) return true;
  return variableGroups.some((g) => g.names.includes(name));
}

// Highlights {{variable}} refs and, when pathParams is true, :paramName
// path segments. Path params are scoped to before the first "?" so a stray
// ":" in a query value or port number (localhost:8087) isn't mistaken for
// one. Unresolved variables get flagged styling when variableGroups is
// passed.
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
    // This span sits under a pointer-events-none overlay so it never gets
    // real hover/click events. data-var lets the hover layer read the name
    // back after looking it up geometrically instead.
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
