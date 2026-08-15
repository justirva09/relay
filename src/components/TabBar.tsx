import React, { useState, useEffect, useRef } from "react";
import { useWorkspace } from "../store";

const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-sky-400",
  PUT: "text-amber-400",
  PATCH: "text-violet-400",
  DELETE: "text-rose-400",
  HEAD: "text-slate-400",
  OPTIONS: "text-slate-400",
};

export default function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs, closeAllTabs, deleteNode, workspace, renameNode } = useWorkspace();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  const nameFor = (nodeId: string) => {
    const find = (nodes: typeof workspace.tree): string | null => {
      for (const n of nodes) {
        if (n.id === nodeId) return n.name;
        if (n.kind === "folder") {
          const found = find(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    return find(workspace.tree) || "untitled";
  };

  const commitRename = (nodeId: string) => {
    setEditingId(null);
    if (editVal.trim() && editVal.trim() !== nameFor(nodeId)) {
      renameNode(nodeId, editVal.trim());
    }
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-th-border bg-th-bg overflow-x-auto overflow-y-hidden shrink-0">
      {tabs.map((tab) => {
        const active = tab.nodeId === activeTabId;
        const isEditing = editingId === tab.nodeId;
        return (
          <div
            key={tab.nodeId}
            onClick={() => setActiveTab(tab.nodeId)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.nodeId });
            }}
            title={`${tab.kind === "grpc" ? "gRPC" : tab.draft.method} ${nameFor(tab.nodeId)}\n${tab.draft.url || "(no URL)"}`}
            className={`group flex items-center gap-2 px-3 py-2 border-r border-th-border cursor-pointer text-[12.5px] whitespace-nowrap ${
              active ? "bg-th-surface text-th-text-1" : "text-th-text-3 hover:text-th-text-1"
            }`}
          >
            {tab.kind === "grpc" ? (
              <span className="font-mono text-[10.5px] font-bold text-th-accent-text">gRPC</span>
            ) : (
              <span className={`font-mono text-[10.5px] font-bold ${METHOD_COLOR[tab.draft.method]}`}>{tab.draft.method}</span>
            )}
            {isEditing ? (
              <input
                autoFocus
                value={editVal}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditVal(e.target.value)}
                onBlur={() => commitRename(tab.nodeId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(tab.nodeId);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="w-[120px] bg-th-bg border border-th-accent-border rounded px-1 py-0.5 text-th-text-1 text-[12.5px] focus:outline-none"
              />
            ) : (
              <span
                className="max-w-[140px] truncate"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(tab.nodeId);
                  setEditVal(nameFor(tab.nodeId));
                }}
              >
                {nameFor(tab.nodeId)}
              </span>
            )}
            {tab.dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.nodeId);
              }}
              className="h-4 w-4 grid place-items-center rounded text-th-text-4 hover:text-rose-400 hover:bg-rose-400/10 opacity-0 group-hover:opacity-100 shrink-0"
            >
              ×
            </button>
          </div>
        );
      })}

      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            onClick={() => { closeTab(ctxMenu.tabId); setCtxMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            Close
          </button>
          <button
            onClick={() => { closeOtherTabs(ctxMenu.tabId); setCtxMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
            disabled={tabs.length <= 1}
          >
            Close Others
          </button>
          <button
            onClick={() => { closeAllTabs(); setCtxMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            Close All
          </button>
          <div className="my-1 border-t border-th-border" />
          <button
            onClick={() => { deleteNode(ctxMenu.tabId); setCtxMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-rose-400 hover:bg-rose-400/10"
          >
            Delete Request
          </button>
        </div>
      )}
    </div>
  );
}
