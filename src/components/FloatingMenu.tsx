import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Renders its children into a portal on document.body, positioned with
// `fixed` coordinates computed from anchorRef's bounding box. Dropdowns
// nested inside a scrollable panel get clipped by that panel's `overflow`
// regardless of z-index — portaling escapes that clipping ancestor entirely.
const FloatingMenu = React.forwardRef<
  HTMLDivElement,
  {
    anchorRef: React.RefObject<HTMLElement>;
    open: boolean;
    className?: string;
    children: React.ReactNode;
  }
>(({ anchorRef, open, className = "", children }, ref) => {
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);

  if (!open || !rect) return null;

  return createPortal(
    <div ref={ref} className={`fixed z-50 ${className}`} style={{ top: rect.top, left: rect.left, width: rect.width }}>
      {children}
    </div>,
    document.body
  );
});

export default FloatingMenu;
