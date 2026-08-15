const KEYWORDS = /\b(var|let|const|function|return|if|else|for|while|do|switch|case|break|continue|new|typeof|instanceof|try|catch|throw|finally|class|import|export|default|from|async|await|yield|of|in|void|delete|this)\b/g;
const BOOLEANS = /\b(true|false|null|undefined)\b/g;
const STRINGS = /(["'`])(?:(?!\1|\\).|\\.)*?\1/g;
const COMMENTS_SINGLE = /\/\/.*$/gm;
const COMMENTS_MULTI = /\/\*[\s\S]*?\*\//g;
const NUMBERS = /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi;
const TEMPLATE_VAR = /\{\{\s*[\w.-]+\s*\}\}/g;
const JSON_KEY = /"(?:[^"\\]|\\.)*"\s*:/g;

interface Span {
  start: number;
  end: number;
  cls: string;
}

function collectSpans(regex: RegExp, code: string, cls: string, spans: Span[], trimEnd = 0) {
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(code)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length - trimEnd, cls });
  }
}

function mergeAndRender(code: string, spans: Span[]): string {
  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of spans) {
    if (merged.length && s.start < merged[merged.length - 1].end) continue;
    merged.push(s);
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const s of merged) {
    if (s.start > cursor) parts.push(escapeHtml(code.slice(cursor, s.start)));
    parts.push(`<span class="${s.cls}">${escapeHtml(code.slice(s.start, s.end))}</span>`);
    cursor = s.end;
  }
  if (cursor < code.length) parts.push(escapeHtml(code.slice(cursor)));
  return parts.join("") + "\n";
}

export function highlightJS(code: string): string {
  const spans: Span[] = [];
  collectSpans(COMMENTS_MULTI, code, "text-th-text-3 italic", spans);
  collectSpans(COMMENTS_SINGLE, code, "text-th-text-3 italic", spans);
  collectSpans(STRINGS, code, "text-th-syn-string", spans);
  collectSpans(TEMPLATE_VAR, code, "text-amber-400 font-semibold", spans);
  collectSpans(KEYWORDS, code, "text-th-syn-key", spans);
  collectSpans(BOOLEANS, code, "text-th-syn-bool", spans);
  collectSpans(NUMBERS, code, "text-th-syn-number", spans);
  return mergeAndRender(code, spans);
}

export function highlightJSON(code: string): string {
  const spans: Span[] = [];
  collectSpans(JSON_KEY, code, "text-th-syn-key", spans, 1);
  collectSpans(STRINGS, code, "text-th-syn-string", spans);
  collectSpans(TEMPLATE_VAR, code, "text-amber-400 font-semibold", spans);
  collectSpans(BOOLEANS, code, "text-th-syn-bool", spans);
  collectSpans(NUMBERS, code, "text-th-syn-number", spans);
  return mergeAndRender(code, spans);
}

export function isJsonLike(code: string): boolean {
  const t = code.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
