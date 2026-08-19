import { RefObject, useEffect, useRef, useState } from "react";

export interface HighlightOptions {
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

export interface UseTextHighlightResult {
  matchCount: number;
  currentIndex: number; // -1 when there are no matches
  goNext: () => void;
  goPrev: () => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(query: string, opts: HighlightOptions): RegExp | null {
  let source = opts.useRegex ? query : escapeRegex(query);
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, opts.caseSensitive ? "g" : "gi");
  } catch {
    return null; // invalid regex mid-typing — just show 0 matches instead of crashing
  }
}

const MARK_ATTR = "data-search-hl";

function unwrapMarks(container: HTMLElement) {
  container.querySelectorAll(`mark[${MARK_ATTR}]`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

// Highlights every match of `query` inside `containerRef`'s rendered text by
// walking its actual DOM text nodes and wrapping matches in <mark> — this
// works regardless of CodeView's own syntax-highlighting spans, since it
// never touches the HTML strings those spans come from, only the live DOM.
export function useTextHighlight(
  containerRef: RefObject<HTMLElement>,
  query: string,
  options: HighlightOptions,
  deps: React.DependencyList
): UseTextHighlightResult {
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const marksRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    unwrapMarks(container);
    marksRef.current = [];

    if (!query) {
      setMatchCount(0);
      setCurrentIndex(-1);
      return;
    }

    const regex = buildRegex(query, options);
    if (!regex) {
      setMatchCount(0);
      setCurrentIndex(-1);
      return;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      // Skips CodeView's line-number gutter (data-no-search) so e.g.
      // searching "1" doesn't match every line-number cell in the margin.
      acceptNode: (n) => (n.parentElement?.closest("[data-no-search]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

    const marks: HTMLElement[] = [];
    for (const textNode of textNodes) {
      const text = textNode.textContent ?? "";
      regex.lastIndex = 0;
      const ranges: [number, number][] = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text))) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        ranges.push([m.index, m.index + m[0].length]);
      }
      if (ranges.length === 0) continue;

      // Split the text node at each match boundary, back to front so
      // earlier offsets stay valid, wrapping each match in a <mark>.
      for (let i = ranges.length - 1; i >= 0; i--) {
        const [start, end] = ranges[i];
        const afterMatch = (textNode as Text).splitText(start);
        const matchNode = afterMatch.splitText(end - start);
        const mark = document.createElement("mark");
        mark.setAttribute(MARK_ATTR, "");
        mark.className = "search-hl";
        afterMatch.parentNode?.insertBefore(mark, matchNode);
        mark.appendChild(afterMatch);
        marks.unshift(mark);
      }
    }

    marksRef.current = marks;
    setMatchCount(marks.length);
    setCurrentIndex(marks.length > 0 ? 0 : -1);

    return () => {
      if (containerRef.current) unwrapMarks(containerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options.caseSensitive, options.useRegex, options.wholeWord, ...deps]);

  useEffect(() => {
    marksRef.current.forEach((mark, i) => mark.classList.toggle("search-hl-current", i === currentIndex));
    if (currentIndex >= 0) marksRef.current[currentIndex]?.scrollIntoView({ block: "center" });
  }, [currentIndex]);

  const goNext = () => {
    if (marksRef.current.length === 0) return;
    setCurrentIndex((i) => (i + 1) % marksRef.current.length);
  };
  const goPrev = () => {
    if (marksRef.current.length === 0) return;
    setCurrentIndex((i) => (i - 1 + marksRef.current.length) % marksRef.current.length);
  };

  return { matchCount, currentIndex, goNext, goPrev };
}
