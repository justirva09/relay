import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(text: string): string {
  if (!text.trim()) return "";
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
