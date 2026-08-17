import { RequestData, encodeUrlencodedRows } from "../types";
import { substituteVars, substitutePathParams } from "./pm";

export interface SnippetFormField {
  key: string;
  value: string;
  isFile: boolean;
}

export interface SnippetRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  formData?: SnippetFormField[];
}

export function toSnippetRequest(draft: RequestData, vars: Record<string, string> = {}): SnippetRequest {
  const headers: [string, string][] = draft.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => [h.key, substituteVars(h.value, vars) ?? h.value]);
  let body =
    draft.bodyMode !== "none" && draft.bodyMode !== "form-data" && draft.bodyMode !== "urlencoded"
      ? substituteVars(draft.bodyText, vars)
      : undefined;
  if (draft.bodyMode === "json" && body !== undefined && !headers.some(([k]) => k.toLowerCase() === "content-type")) {
    headers.push(["Content-Type", "application/json"]);
  }
  if (draft.bodyMode === "urlencoded") {
    body = encodeUrlencodedRows(draft.bodyUrlencoded.map((r) => ({ ...r, value: substituteVars(r.value, vars) ?? r.value })));
    if (!headers.some(([k]) => k.toLowerCase() === "content-type")) {
      headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
    }
  }
  const formData =
    draft.bodyMode === "form-data"
      ? draft.bodyForm
          .filter((f) => f.enabled && f.key.trim())
          .map((f) => ({ key: f.key, value: f.type === "file" ? f.value : substituteVars(f.value, vars) ?? f.value, isFile: f.type === "file" }))
      : undefined;
  const url = substituteVars(substitutePathParams(draft.url, draft.pathParams), vars) || "https://api.example.com";
  return { method: draft.method, url, headers, body, formData };
}

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function shEsc(s: string) {
  return s.replace(/'/g, `'\\''`);
}

function hasBody(req: SnippetRequest) {
  return req.body !== undefined && !["GET", "HEAD"].includes(req.method);
}

export const SNIPPET_LANGS = [
  "cURL",
  "JavaScript - Fetch",
  "JavaScript - Axios",
  "Node.js - Axios",
  "Python - Requests",
  "Go - net/http",
] as const;

export type SnippetLang = (typeof SNIPPET_LANGS)[number];

export function generateSnippet(lang: SnippetLang, req: SnippetRequest): string {
  switch (lang) {
    case "cURL": {
      const lines = [`curl --request ${req.method} \\`, `  --url '${shEsc(req.url)}'`];
      for (const [k, v] of req.headers) lines.push(` \\\n  --header '${shEsc(k)}: ${shEsc(v)}'`);
      if (req.formData?.length) {
        for (const f of req.formData) {
          const val = f.isFile ? `@${shEsc(f.value)}` : shEsc(f.value);
          lines.push(` \\\n  --form '${shEsc(f.key)}=${val}'`);
        }
      } else if (hasBody(req)) {
        lines.push(` \\\n  --data '${shEsc(req.body!)}'`);
      }
      return lines.join("");
    }

    case "JavaScript - Fetch": {
      const headerLines = req.headers.map(([k, v]) => `    "${esc(k)}": "${esc(v)}",`).join("\n");
      const bodyLine = hasBody(req) ? `\n  body: JSON.stringify(${safeBodyLiteral(req.body!)}),` : "";
      return `const response = await fetch("${esc(req.url)}", {
  method: "${req.method}",
  headers: {
${headerLines}
  },${bodyLine}
});

const data = await response.json();
console.log(data);`;
    }

    case "JavaScript - Axios":
    case "Node.js - Axios": {
      const headerLines = req.headers.map(([k, v]) => `    "${esc(k)}": "${esc(v)}",`).join("\n");
      const dataLine = hasBody(req) ? `\n  data: ${safeBodyLiteral(req.body!)},` : "";
      const importLine = lang === "Node.js - Axios" ? `const axios = require("axios");\n\n` : `import axios from "axios";\n\n`;
      return `${importLine}const response = await axios({
  method: "${req.method}",
  url: "${esc(req.url)}",
  headers: {
${headerLines}
  },${dataLine}
});

console.log(response.data);`;
    }

    case "Python - Requests": {
      const headerEntries = req.headers.map(([k, v]) => `    "${esc(k)}": "${esc(v)}",`).join("\n");
      const dataLine = hasBody(req) ? `\npayload = ${pythonBodyLiteral(req.body!)}\n` : "";
      const dataArg = hasBody(req) ? ", json=payload" : "";
      return `import requests
${dataLine}
headers = {
${headerEntries}
}

response = requests.request("${req.method}", "${esc(req.url)}", headers=headers${dataArg})

print(response.text)`;
    }

    case "Go - net/http": {
      const bodyVar = hasBody(req)
        ? `payload := strings.NewReader(\`${req.body}\`)\n\n\t`
        : "";
      const bodyArg = hasBody(req) ? "payload" : "nil";
      const headerLines = req.headers.map(([k, v]) => `\treq.Header.Add("${esc(k)}", "${esc(v)}")`).join("\n");
      return `package main

import (
\t"fmt"
\t"net/http"${hasBody(req) ? '\n\t"strings"' : ""}
\t"io"
)

func main() {
\t${bodyVar}req, _ := http.NewRequest("${req.method}", "${esc(req.url)}", ${bodyArg})

${headerLines}

\tres, _ := http.DefaultClient.Do(req)
\tdefer res.Body.Close()
\tbody, _ := io.ReadAll(res.Body)

\tfmt.Println(string(body))
}`;
    }

    default:
      return "";
  }
}

function safeBodyLiteral(body: string): string {
  try {
    JSON.parse(body);
    return body;
  } catch {
    return JSON.stringify(body);
  }
}

function pythonBodyLiteral(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 4).replace(/: true/g, ": True").replace(/: false/g, ": False").replace(/: null/g, ": None");
  } catch {
    return JSON.stringify(body);
  }
}
