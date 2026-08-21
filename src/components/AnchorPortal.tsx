import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// portals children into a fixed-position shadow of anchorRef's box (same
// top/left/width/height, invisible, pointer-events disabled), so existing
// `position: absolute` children (e.g. VariableMenuList's `top: 100%; left: Nch`)
// keep resolving against that box like before, while escaping any scrollable
// ancestor that would otherwise clip them regardless of z-index
export default function AnchorPortal({ anchorRef, children }: { anchorRef: React.RefObject<HTMLElement>; children: React.ReactNode }) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef]);

  if (!rect) return null;

  return createPortal(
    <div style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, height: rect.height, pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto" }}>{children}</div>
    </div>,
    document.body
  );
}
