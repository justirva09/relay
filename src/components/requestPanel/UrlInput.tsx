import React, { useRef, useState } from "react";
import { useVariableMenu, VariableGroup } from "../../lib/useVariableMenu";
import { useWorkspace } from "../../store";
import { useVariableHover, variableTokenAtElement, useModifierHeld, VariableInfo } from "../../lib/useVariableHover";
import { highlightUrlTokens } from "../../lib/urlHighlight";
import VariableMenuList from "../VariableMenuList";
import AnchorPortal from "../AnchorPortal";
import VariableHoverTooltip from "../VariableHoverTooltip";

export default function UrlInput({ value, onChange, onKeyDown, placeholder, variables, variableInfo }: {
  value: string;
  onChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  variables?: VariableGroup[];
  variableInfo?: VariableInfo;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const { menu, recompute, close, move, hover, apply } = useVariableMenu(variables);
  const { openEnvironmentModal } = useWorkspace();
  const hovered = useVariableHover(wrapRef, overlayRef);
  const modifierHeld = useModifierHeld();

  const syncScroll = () => {
    requestAnimationFrame(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
      }
    });
  };

  const select = (item: string) => {
    const result = apply(value, item);
    if (!result) return;
    onChange(result.next);
    close();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (inputRef.current) inputRef.current.selectionStart = inputRef.current.selectionEnd = result.cursor;
    });
  };

  return (
    <div ref={wrapRef} className="flex-1 min-w-0 relative">
      <div
        className={`relative overflow-hidden bg-th-surface border rounded-md ${focused ? "border-th-border-focus" : "border-th-border-input"}`}
        onClick={(e) => {
          if ((e.metaKey || e.ctrlKey) && variableInfo) {
            const name = variableTokenAtElement(overlayRef.current, e.clientX, e.clientY);
            const info = name ? variableInfo[name] : undefined;
            if (info) {
              openEnvironmentModal(info.tabId, name!);
              return;
            }
          }
          inputRef.current?.focus();
        }}
      >
        <div ref={overlayRef} className="px-3 py-2 text-[13px] font-mono whitespace-pre overflow-hidden pointer-events-none" aria-hidden>
          {value ? highlightUrlTokens(value, true, variables) : <span className="text-th-text-4">{placeholder}</span>}
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); syncScroll(); recompute(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onKeyDown={(e) => {
            if (menu) {
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); move(-1); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(menu.items[menu.activeIndex].name); return; }
              if (e.key === "Escape") { e.preventDefault(); close(); return; }
            }
            onKeyDown(e);
          }}
          onKeyUp={(e) => {
            syncScroll();
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) recompute(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          }}
          onScroll={syncScroll}
          onFocus={() => { setFocused(true); syncScroll(); }}
          onBlur={() => { setFocused(false); close(); }}
          className="absolute inset-0 w-full h-full px-3 py-2 text-[13px] font-mono bg-transparent text-transparent caret-slate-200 focus:outline-none"
          style={hovered && modifierHeld ? { cursor: "pointer" } : undefined}
          spellCheck={false}
        />
      </div>
      {menu && (
        <AnchorPortal anchorRef={wrapRef}>
          <VariableMenuList
            items={menu.items}
            activeIndex={menu.activeIndex}
            onHover={hover}
            onSelect={select}
            style={{ top: "100%", left: `${menu.col}ch`, marginTop: "4px" }}
          />
        </AnchorPortal>
      )}
      {hovered && <VariableHoverTooltip x={hovered.x} y={hovered.y} name={hovered.name} info={variableInfo?.[hovered.name]} />}
    </div>
  );
}
