import React, { useState, useEffect, useRef } from "react";
import { TreeNode } from "../types";
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

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-th-text-3">
      {open ? (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7Z M3 10h20v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8Z" fill="currentColor" opacity="0.7" />
      ) : (
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" fill="currentColor" opacity="0.7" />
      )}
    </svg>
  );
}

interface CtxMenuState {
  x: number;
  y: number;
  nodeId: string;
  kind: "folder" | "request" | "grpc";
}

function AddRequestDropdown({ title, onAddHttp, onAddGrpc, className }: {
  title: string;
  onAddHttp: () => void;
  onAddGrpc: () => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button title={title} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className={className}>
        +
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[160px]">
          <button
            onClick={(e) => { e.stopPropagation(); onAddHttp(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            HTTP Request
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddGrpc(); setOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            gRPC Request
          </button>
        </div>
      )}
    </div>
  );
}

interface DropInfo {
  id: string;
  position: "before" | "after" | "inside";
}

let suppressNextClick = false;

function TreeItem({ node, depth, onCtxMenu, triggerEditId, clearTriggerEdit, onDelete, dragId, dropInfo, onItemMouseDown }: {
  node: TreeNode;
  depth: number;
  onCtxMenu: (e: React.MouseEvent, node: TreeNode) => void;
  triggerEditId: string | null;
  clearTriggerEdit: () => void;
  onDelete: (id: string) => void;
  dragId: string | null;
  dropInfo: DropInfo | null;
  onItemMouseDown: (nodeId: string, e: React.MouseEvent) => void;
}) {
  const { addFolder, addRequest, addGrpcRequest, renameNode, toggleCollapse, openTab, activeTabId, tabs } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(node.name);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (triggerEditId === node.id) {
      setEditing(true);
      setEditVal(node.name);
      clearTriggerEdit();
    }
  }, [triggerEditId, node.id, node.name, clearTriggerEdit]);

  const commitRename = () => {
    setEditing(false);
    if (editVal.trim() && editVal !== node.name) renameNode(node.id, editVal.trim());
    else setEditVal(node.name);
  };

  const isDragging = dragId === node.id;
  const isDropTarget = dropInfo?.id === node.id;
  const dropPos = isDropTarget ? dropInfo!.position : null;

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.button !== 0) return;
    onItemMouseDown(node.id, e);
  };

  if (node.kind === "folder") {
    return (
      <div>
        <div
          data-tree-id={node.id}
          data-tree-kind="folder"
          onMouseDown={handleMouseDown}
          className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] transition-colors ${
            isDragging ? "opacity-30" : "opacity-100"
          } ${
            dropPos === "inside" ? "bg-th-accent-bg ring-1 ring-th-accent-border" : "hover:bg-th-hover"
          } ${
            dropPos === "before" ? "border-t-2 border-th-accent" : ""
          } ${
            dropPos === "after" ? "border-b-2 border-th-accent" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => { if (suppressNextClick) return; toggleCollapse(node.id); }}
          onContextMenu={(e) => onCtxMenu(e, node)}
        >
          <FolderIcon open={!node.collapsed} />
          {editing ? (
            <input
              autoFocus
              value={editVal}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setEditing(false); setEditVal(node.name); }
              }}
              className="flex-1 bg-th-surface border border-th-accent-border rounded px-1 py-0.5 text-th-text-1 text-[13px] focus:outline-none"
            />
          ) : (
            <span className="flex-1 truncate text-th-text-1" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>
              {node.name}
            </span>
          )}
          {hover && !editing && (
            <div className="flex items-center gap-0.5 opacity-80">
              <AddRequestDropdown
                title="New request"
                onAddHttp={() => addRequest(node.id)}
                onAddGrpc={() => addGrpcRequest(node.id)}
                className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
              />
              <button
                title="New folder"
                onClick={(e) => { e.stopPropagation(); addFolder(node.id); }}
                className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg text-[11px]"
              >
                📁
              </button>
              <button
                title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
                className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10"
              >
                ×
              </button>
            </div>
          )}
        </div>
        {!node.collapsed && (
          <div>
            {node.children.length === 0 && (
              <div className="text-[11.5px] text-th-text-4 font-mono" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                empty
              </div>
            )}
            {node.children.map((c) => (
              <TreeItem key={c.id} node={c} depth={depth + 1} onCtxMenu={onCtxMenu} triggerEditId={triggerEditId} clearTriggerEdit={clearTriggerEdit} onDelete={onDelete} dragId={dragId} dropInfo={dropInfo} onItemMouseDown={onItemMouseDown} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isOpen = tabs.some((t) => t.nodeId === node.id);
  const isActive = activeTabId === node.id;
  const isDirty = tabs.find((t) => t.nodeId === node.id)?.dirty;

  if (node.kind === "grpc") {
    return (
      <div
        data-tree-id={node.id}
        data-tree-kind="grpc"
        onMouseDown={handleMouseDown}
        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] ${
          isDragging ? "opacity-30" : "opacity-100"
        } ${
          isActive && !isDropTarget ? "bg-th-accent-bg" : !isDropTarget ? "hover:bg-th-hover" : ""
        } ${
          dropPos === "before" ? "border-t-2 border-th-accent" : ""
        } ${
          dropPos === "after" ? "border-b-2 border-th-accent" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => { if (suppressNextClick) return; openTab(node.id); }}
        onContextMenu={(e) => onCtxMenu(e, node)}
      >
        <span className="font-mono text-[9.5px] font-bold w-9 shrink-0 text-th-accent-text">gRPC</span>
        {editing ? (
          <input
            autoFocus
            value={editVal}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditing(false); setEditVal(node.name); }
            }}
            className="flex-1 bg-th-surface border border-th-accent-border rounded px-1 py-0.5 text-th-text-1 text-[13px] focus:outline-none"
          />
        ) : (
          <span
            className={`flex-1 truncate ${isActive || isOpen ? "text-th-text-1" : "text-th-text-2"}`}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {node.name}
          </span>
        )}
        {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
        {hover && !editing && (
          <button
            title="Delete"
            onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
            className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10 shrink-0"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-tree-id={node.id}
      data-tree-kind="request"
      onMouseDown={handleMouseDown}
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] ${
        isDragging ? "opacity-30" : "opacity-100"
      } ${
        isActive && !isDropTarget ? "bg-th-accent-bg" : !isDropTarget ? "hover:bg-th-hover" : ""
      } ${
        dropPos === "before" ? "border-t-2 border-th-accent" : ""
      } ${
        dropPos === "after" ? "border-b-2 border-th-accent" : ""
      }`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (suppressNextClick) return; openTab(node.id); }}
      onContextMenu={(e) => onCtxMenu(e, node)}
    >
      <span className={`font-mono text-[10.5px] font-bold w-9 shrink-0 ${METHOD_COLOR[node.request.method]}`}>{node.request.method}</span>
      {editing ? (
        <input
          autoFocus
          value={editVal}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") { setEditing(false); setEditVal(node.name); }
          }}
          className="flex-1 bg-th-surface border border-th-accent-border rounded px-1 py-0.5 text-th-text-1 text-[13px] focus:outline-none"
        />
      ) : (
        <span
          className={`flex-1 truncate ${isActive || isOpen ? "text-th-text-1" : "text-th-text-2"}`}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        >
          {node.name}
        </span>
      )}
      {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
      {hover && !editing && (
        <button
          title="Delete"
          onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
          className="h-5 w-5 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10 shrink-0"
        >
          ×
        </button>
      )}
    </div>
  );
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;

export default function Sidebar() {
  const { workspace, addFolder, addRequest, addGrpcRequest, deleteNode, moveNode } = useWorkspace();
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [triggerEditId, setTriggerEditId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<DropInfo | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("relay-sidebar-width"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      setWidth((w) => {
        localStorage.setItem("relay-sidebar-width", String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  const dragStartRef = useRef<{ nodeId: string; y: number } | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const dropInfoRef = useRef<DropInfo | null>(null);
  dragIdRef.current = dragId;
  dropInfoRef.current = dropInfo;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;

      if (!dragIdRef.current && Math.abs(e.clientY - start.y) < 5) return;

      if (!dragIdRef.current) {
        setDragId(start.nodeId);
        dragIdRef.current = start.nodeId;
        suppressNextClick = true;
      }

      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-tree-id]") as HTMLElement | null;
      if (!el || el.dataset.treeId === start.nodeId) {
        setDropInfo(null);
        dropInfoRef.current = null;
        return;
      }

      const rect = el.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const kind = el.dataset.treeKind;
      let pos: DropInfo["position"];
      if (ratio < 0.25) pos = "before";
      else if (ratio > 0.75) pos = "after";
      else pos = kind === "folder" ? "inside" : "after";

      const info = { id: el.dataset.treeId!, position: pos };
      setDropInfo(info);
      dropInfoRef.current = info;
    };

    const onUp = () => {
      const did = dragIdRef.current;
      const di = dropInfoRef.current;
      if (dragStartRef.current && did && di) {
        moveNode(did, di.id, di.position);
      }
      dragStartRef.current = null;
      setDragId(null);
      setDropInfo(null);
      dragIdRef.current = null;
      dropInfoRef.current = null;
      setTimeout(() => { suppressNextClick = false; }, 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [moveNode]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  const handleItemMouseDown = (nodeId: string, e: React.MouseEvent) => {
    dragStartRef.current = { nodeId, y: e.clientY };
  };

  const handleCtxMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id, kind: node.kind });
  };

  const findName = (id: string): string => {
    const search = (nodes: TreeNode[]): string | null => {
      for (const n of nodes) {
        if (n.id === id) return n.name;
        if (n.kind === "folder") {
          const found = search(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    return search(workspace.tree) || "Untitled";
  };

  return (
    <div className="relative shrink-0 border-r border-th-border bg-th-sidebar flex flex-col h-full" style={{ width }}>
      <div className="h-[49px] px-3 flex items-center justify-between border-b border-th-border shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-mono text-th-text-2 tracking-wide">Collections</span>
        </div>
        <div className="flex items-center gap-1">
          <AddRequestDropdown
            title="New request"
            onAddHttp={() => {
              const id = addRequest(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            onAddGrpc={() => {
              const id = addGrpcRequest(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg text-[13px]"
          />
          <button
            title="New folder"
            onClick={() => {
              const id = addFolder(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg text-[12px]"
          >
            📁
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto py-2">
        {workspace.tree.length === 0 && <div className="px-3 text-[12px] text-th-text-4 font-mono">no collections yet</div>}
        {workspace.tree.map((n) => (
          <TreeItem key={n.id} node={n} depth={0} onCtxMenu={handleCtxMenu} triggerEditId={triggerEditId} clearTriggerEdit={() => setTriggerEditId(null)} onDelete={(id) => setPendingDeleteId(id)} dragId={dragId} dropInfo={dropInfo} onItemMouseDown={handleItemMouseDown} />
        ))}
      </div>

      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {ctxMenu.kind === "folder" && (
            <>
              <button
                onClick={() => {
                  const id = addRequest(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New HTTP Request
              </button>
              <button
                onClick={() => {
                  const id = addGrpcRequest(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New gRPC Request
              </button>
              <button
                onClick={() => {
                  const id = addFolder(ctxMenu.nodeId);
                  setCtxMenu(null);
                  if (id) setTimeout(() => setTriggerEditId(id), 50);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                New Folder
              </button>
              <div className="my-1 border-t border-th-border" />
            </>
          )}
          <button
            onClick={() => {
              setTriggerEditId(ctxMenu.nodeId);
              setCtxMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
          >
            Rename
          </button>
          <button
            onClick={() => {
              setPendingDeleteId(ctxMenu.nodeId);
              setCtxMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] text-rose-400 hover:bg-rose-400/10"
          >
            Delete
          </button>
        </div>
      )}

      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={() => setPendingDeleteId(null)}>
          <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[340px] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-semibold text-th-text-1 mb-2">Delete</h3>
            <p className="text-[13px] text-th-text-2 mb-5">
              Delete <span className="text-th-text-1 font-mono">"{findName(pendingDeleteId)}"</span>? This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDeleteId(null)}
                className="px-3 py-1.5 rounded text-[12.5px] text-th-text-2 hover:text-th-text-1 hover:bg-th-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = pendingDeleteId;
                  setPendingDeleteId(null);
                  deleteNode(id);
                }}
                className="px-3 py-1.5 rounded text-[12.5px] bg-rose-500 text-white hover:bg-rose-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
        className={`absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-th-accent-border ${resizing ? "bg-th-accent-border" : ""}`}
        style={{ transform: "translateX(50%)" }}
      />
    </div>
  );
}
