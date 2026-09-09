import React, { ComponentProps, useEffect, useRef, useState } from "react";
import CodeEditor from "./CodeEditor";

interface Props extends ComponentProps<typeof CodeEditor> {
  storageKey: string;
  defaultHeight: number;
  minHeight?: number;
  resizeLabel?: string;
}

function maximumHeight(minHeight: number): number {
  return Math.max(minHeight, Math.floor(window.innerHeight * 0.8));
}

function clampHeight(height: number, minHeight: number): number {
  return Math.min(maximumHeight(minHeight), Math.max(minHeight, height));
}

export default function ResizableCodeEditor({
  storageKey,
  defaultHeight,
  minHeight = 128,
  resizeLabel = "request body editor",
  className = "",
  ...editorProps
}: Props) {
  const [height, setHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved > 0
        ? clampHeight(saved, minHeight)
        : clampHeight(defaultHeight, minHeight);
    } catch {
      return clampHeight(defaultHeight, minHeight);
    }
  });
  const [resizing, setResizing] = useState(false);
  const dragStart = useRef({ y: 0, height: defaultHeight });
  const heightRef = useRef(height);

  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  useEffect(() => {
    if (!resizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const move = (event: PointerEvent) => {
      const next = clampHeight(dragStart.current.height + event.clientY - dragStart.current.y, minHeight);
      heightRef.current = next;
      setHeight(next);
    };
    const stop = () => {
      setResizing(false);
      try {
        localStorage.setItem(storageKey, String(Math.round(heightRef.current)));
      } catch {
        // Storage can be unavailable in hardened webviews; resizing still works for this session.
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [minHeight, resizing, storageKey]);

  const setAndSaveHeight = (nextHeight: number) => {
    const next = clampHeight(nextHeight, minHeight);
    heightRef.current = next;
    setHeight(next);
    try {
      localStorage.setItem(storageKey, String(Math.round(next)));
    } catch {
      // Keep the in-memory size when storage is unavailable.
    }
  };

  return (
    <div className="flex flex-col min-h-0" style={{ height }}>
      <CodeEditor {...editorProps} className={`flex-1 min-h-0 ${className}`} />
      <div
        role="separator"
        aria-label={`Resize ${resizeLabel}`}
        aria-orientation="horizontal"
        aria-valuemin={minHeight}
        aria-valuemax={maximumHeight(minHeight)}
        aria-valuenow={Math.round(height)}
        tabIndex={0}
        title="Drag to resize - double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault();
          dragStart.current = { y: event.clientY, height };
          setResizing(true);
        }}
        onDoubleClick={() => setAndSaveHeight(defaultHeight)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "Home") return;
          event.preventDefault();
          if (event.key === "Home") setAndSaveHeight(defaultHeight);
          else setAndSaveHeight(height + (event.key === "ArrowDown" ? 16 : -16));
        }}
        className={`group h-2 shrink-0 cursor-row-resize grid place-items-center outline-none ${
          resizing ? "text-th-accent-text" : "text-th-text-4 hover:text-th-accent-text focus:text-th-accent-text"
        }`}
      >
        <span className="block h-px w-10 rounded-full bg-current transition-all group-hover:w-14 group-focus:w-14" />
      </div>
    </div>
  );
}
