import {
  AuthConfig,
  BodyMode,
  FormDataRow,
  KVRow,
  Method,
  RequestData,
  defaultAuth,
  defaultRequestSettings,
  newFormDataRow,
  newRow,
  parsePathParamsFromUrl,
  parseQueryToRows,
  uid,
} from "../types";

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// small shell-style tokenizer: handles quotes (so a multi-line JSON --data
// body doesn't get split) and backslash line continuations, no real shell needed
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;
    let token = "";
    let sawAnyChar = false;
    while (i < n && !/\s/.test(input[i])) {
      const ch = input[i];
      if (ch === "'") {
        i++;
        while (i < n && input[i] !== "'") {
          token += input[i];
          i++;
        }
        i++;
        sawAnyChar = true;
      } else if (ch === '"') {
        i++;
        while (i < n && input[i] !== '"') {
          if (input[i] === "\\" && i + 1 < n && '"\\$`'.includes(input[i + 1])) {
            token += input[i + 1];
            i += 2;
          } else {
            token += input[i];
            i++;
          }
        }
        i++;
        sawAnyChar = true;
      } else if (ch === "\\" && input[i + 1] === "\n") {
        // line continuation, treat like whitespace
        i += 2;
        break;
      } else if (ch === "\\" && i + 1 < n) {
        token += input[i + 1];
        i += 2;
        sawAnyChar = true;
      } else {
        token += ch;
        i++;
        sawAnyChar = true;
      }
    }
    if (sawAnyChar || token) tokens.push(token);
  }
  return tokens;
}

function decodeBasicAuthHeader(value: string): AuthConfig | null {
  const m = /^basic\s+(.+)$/i.exec(value.trim());
  if (!m) return null;
  try {
    const decoded = atob(m[1].trim());
    const sep = decoded.indexOf(":");
    const username = sep === -1 ? decoded : decoded.slice(0, sep);
    const password = sep === -1 ? "" : decoded.slice(sep + 1);
    return { type: "basic", basic: { username, password } };
  } catch {
    return null;
  }
}

function deriveName(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || u.hostname || "Imported request";
  } catch {
    const stripped = url.split("?")[0].split("/").filter(Boolean);
    return stripped[stripped.length - 1] || "Imported request";
  }
}

export interface ParsedCurl {
  name: string;
  request: RequestData;
}

// best-effort curl -> RequestData, covers the flags people actually paste
// from docs or "Copy as cURL". unknown flags get ignored, not rejected.
export function parseCurlCommand(input: string): ParsedCurl | null {
  const trimmed = input.trim().replace(/^\$\s*/, "");
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  let i = 0;
  if (tokens[i]?.toLowerCase() === "curl") i++;

  let method: Method | null = null;
  let url = "";
  const headers: KVRow[] = [];
  const formRows: FormDataRow[] = [];
  const bodyParts: string[] = [];
  let isFormData = false;
  let auth: AuthConfig = defaultAuth();

  for (; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t) {
      case "-X":
      case "--request": {
        const m = (tokens[++i] || "GET").toUpperCase();
        method = (METHODS as string[]).includes(m) ? (m as Method) : "GET";
        break;
      }
      case "--url":
        url = tokens[++i] || url;
        break;
      case "-H":
      case "--header": {
        const h = tokens[++i] || "";
        const cIdx = h.indexOf(":");
        if (cIdx > -1) {
          const key = h.slice(0, cIdx).trim();
          const value = h.slice(cIdx + 1).trim();
          if (key.toLowerCase() === "authorization") {
            const bearerMatch = /^bearer\s+(.+)$/i.exec(value);
            if (bearerMatch) {
              auth = { type: "bearer", bearer: { token: bearerMatch[1].trim() } };
              break;
            }
            const basic = decodeBasicAuthHeader(value);
            if (basic) {
              auth = basic;
              break;
            }
          }
          headers.push({ id: uid(), key, value, enabled: true });
        }
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
      case "--data-urlencode":
        bodyParts.push(tokens[++i] || "");
        break;
      case "-F":
      case "--form": {
        isFormData = true;
        const f = tokens[++i] || "";
        const eqIdx = f.indexOf("=");
        if (eqIdx > -1) {
          const key = f.slice(0, eqIdx);
          const rawValue = f.slice(eqIdx + 1);
          const isFile = rawValue.startsWith("@");
          formRows.push({ id: uid(), key, value: isFile ? rawValue.slice(1) : rawValue, type: isFile ? "file" : "text", enabled: true });
        }
        break;
      }
      case "-u":
      case "--user": {
        const cred = tokens[++i] || "";
        const cIdx = cred.indexOf(":");
        const username = cIdx > -1 ? cred.slice(0, cIdx) : cred;
        const password = cIdx > -1 ? cred.slice(cIdx + 1) : "";
        auth = { type: "basic", basic: { username, password } };
        break;
      }
      case "-A":
      case "--user-agent":
        headers.push({ id: uid(), key: "User-Agent", value: tokens[++i] || "", enabled: true });
        break;
      case "-b":
      case "--cookie":
        headers.push({ id: uid(), key: "Cookie", value: tokens[++i] || "", enabled: true });
        break;
      case "-I":
      case "--head":
        method = method ?? "HEAD";
        break;
      case "-G":
      case "--get":
        method = "GET";
        break;
      default:
        // unhandled flags (-k, -v, -L, --compressed, ...) just get skipped.
        // a bare non-flag token is the url
        if (!t.startsWith("-") && !url) url = t;
        break;
    }
  }

  if (!url) return null;
  if (!method) method = bodyParts.length || isFormData ? "POST" : "GET";

  const hasJsonContentType = headers.some((h) => h.key.toLowerCase() === "content-type" && h.value.toLowerCase().includes("json"));
  const rawBody = bodyParts.join("&");

  let bodyMode: BodyMode = "none";
  let bodyText = "";
  if (isFormData) {
    bodyMode = "form-data";
  } else if (rawBody) {
    if (hasJsonContentType || /^\s*[{[]/.test(rawBody)) {
      bodyMode = "json";
      try {
        bodyText = JSON.stringify(JSON.parse(rawBody), null, 2);
      } catch {
        bodyText = rawBody;
      }
    } else {
      bodyMode = "text";
      bodyText = rawBody;
    }
  }

  const request: RequestData = {
    method,
    url,
    description: "",
    params: parseQueryToRows(url),
    pathParams: parsePathParamsFromUrl(url),
    headers: headers.length ? headers : [newRow()],
    auth,
    bodyMode,
    bodyText,
    bodyForm: formRows.length ? [...formRows, newFormDataRow()] : [newFormDataRow()],
    bodyUrlencoded: [newRow()],
    preScript: "",
    testScript: "",
    examples: [],
    tags: [],
    settings: defaultRequestSettings(),
  };

  return { name: deriveName(url), request };
}
