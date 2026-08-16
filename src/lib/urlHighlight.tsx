import React from "react";

const TOKEN_RE = /(\{\{[^}]*\}\})|(:[A-Za-z_]\w*)/g;

// Highlights {{variable}} references (anywhere) and, when `pathParams` is
// true, Postman-style :paramName path segments — scoped to the part of the
// URL before the first "?", so a stray ":" inside a query value (or a port
// number like "localhost:8087") never gets mistaken for a path param.
export function highlightUrlTokens(text: string, pathParams: boolean): React.ReactNode[] {
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
    parts.push(
      <span key={match.index} className={isPathParam ? "text-sky-400" : "text-orange-400"}>
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 0) parts.push(" ");
  return parts;
}
