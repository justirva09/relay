import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { escapeHtml } from "./highlight";

Object.entries({ bash, csharp, css, go, javascript, json, php, python, rust, sql, typescript, xml, yaml }).forEach(
  ([name, grammar]) => hljs.registerLanguage(name, grammar)
);
hljs.registerAliases(["sh", "shell"], { languageName: "bash" });
hljs.registerAliases(["c#", "cs"], { languageName: "csharp" });
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["yml"], { languageName: "yaml" });

const options = { breaks: false, gfm: true, async: false } as const;
const codeRenderer = {
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang?.split(/\s+/)[0].toLowerCase();
      const detected = !language && /^\s*<(?:[a-z!/]|\?xml)/i.test(text) ? "xml" : language;
      const highlighted = detected && hljs.getLanguage(detected) && text.length < 100_000
        ? hljs.highlight(text, { language: detected, ignoreIllegals: true }).value
        : escapeHtml(text);
      return `<pre><code class="hljs">${highlighted}</code></pre>`;
    },
  },
};
const markdown = new Marked(options, markedFootnote({ refMarkers: true }), codeRenderer);

export function renderMarkdown(text: string, idPrefix?: string): string {
  if (!text.trim()) return "";
  const parser = idPrefix
    ? new Marked(options, markedFootnote({ prefixId: `${idPrefix.replace(/[^a-zA-Z0-9-]/g, "-")}-footnote-`, refMarkers: true }), codeRenderer)
    : markdown;
  const html = parser.parse(text) as string;
  return DOMPurify.sanitize(html);
}
