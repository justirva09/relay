import React, { useState, useEffect } from "react";
import { GrpcMethodType, TreeNode } from "../../types";
import { useWorkspace } from "../../store";
import { AddRequestDropdown } from "./AddRequestDropdown";
import { METHOD_COLOR, DropInfo, getSuppressNextClick } from "./shared";

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

const GRPC_METHOD_BADGE: Record<GrpcMethodType, { icon: string; color: string; label: string }> = {
  unary: { icon: "→", color: "text-emerald-400", label: "Unary" },
  "server-stream": { icon: "↓", color: "text-amber-400", label: "Server streaming" },
  "client-stream": { icon: "↑", color: "text-sky-400", label: "Client streaming" },
  bidi: { icon: "↕", color: "text-violet-400", label: "Bidirectional streaming" },
};

export function TreeItem({ node, depth, onCtxMenu, triggerEditId, clearTriggerEdit, onDelete, draggingIds, dropInfo, selectedIds, onItemMouseDown, onItemClick, onAddFromCurl, onImportGrpc }: {
  node: TreeNode;
  depth: number;
  onCtxMenu: (e: React.MouseEvent, node: TreeNode) => void;
  triggerEditId: string | null;
  clearTriggerEdit: () => void;
  onDelete: (id: string) => void;
  draggingIds: Set<string> | null;
  dropInfo: DropInfo | null;
  selectedIds: Set<string>;
  onItemMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onItemClick: (nodeId: string, e: React.MouseEvent) => boolean;
  onAddFromCurl: (parentId: string) => void;
  onImportGrpc: (parentId: string) => void;
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

  const isDragging = draggingIds?.has(node.id) ?? false;
  const isSelected = selectedIds.has(node.id);
  const isDropTarget = dropInfo?.id === node.id;
  const dropPos = isDropTarget ? dropInfo!.position : null;

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.button !== 0) return;
    if (e.shiftKey) e.preventDefault(); // stop the browser's native shift-click text-range selection
    onItemMouseDown(node.id, e);
  };

  if (node.kind === "folder") {
    return (
      <div>
        <div
          data-tree-id={node.id}
          data-tree-kind="folder"
          onMouseDown={handleMouseDown}
          className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] transition-colors select-none ${
            isDragging ? "opacity-30" : "opacity-100"
          } ${
            dropPos === "inside" ? "bg-th-accent-bg ring-1 ring-th-accent-border" : isSelected ? "bg-th-accent-bg" : "hover:bg-th-hover"
          } ${
            dropPos === "before" ? "border-t-2 border-th-accent" : ""
          } ${
            dropPos === "after" ? "border-b-2 border-th-accent" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => { if (getSuppressNextClick()) return; if (!onItemClick(node.id, e)) return; toggleCollapse(node.id); }}
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
                onImportGrpc={() => onImportGrpc(node.id)}
                onAddFromCurl={() => onAddFromCurl(node.id)}
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
              <TreeItem key={c.id} node={c} depth={depth + 1} onCtxMenu={onCtxMenu} triggerEditId={triggerEditId} clearTriggerEdit={clearTriggerEdit} onDelete={onDelete} draggingIds={draggingIds} dropInfo={dropInfo} selectedIds={selectedIds} onItemMouseDown={onItemMouseDown} onItemClick={onItemClick} onAddFromCurl={onAddFromCurl} onImportGrpc={onImportGrpc} />
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
    const methodBadge = GRPC_METHOD_BADGE[node.request.methodType] ?? GRPC_METHOD_BADGE.unary;
    return (
      <div
        data-tree-id={node.id}
        data-tree-kind="grpc"
        onMouseDown={handleMouseDown}
        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] select-none ${
          isDragging ? "opacity-30" : "opacity-100"
        } ${
          isSelected || (isActive && !isDropTarget) ? "bg-th-accent-bg" : !isDropTarget ? "hover:bg-th-hover" : ""
        } ${
          dropPos === "before" ? "border-t-2 border-th-accent" : ""
        } ${
          dropPos === "after" ? "border-b-2 border-th-accent" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => { if (getSuppressNextClick()) return; if (!onItemClick(node.id, e)) return; openTab(node.id); }}
        onContextMenu={(e) => onCtxMenu(e, node)}
      >
        <span
          title={`${methodBadge.label} · ${node.request.protoSource === "reflection" ? "Server reflection" : "Imported proto"}`}
          className={`font-mono text-[15px] font-bold w-9 text-center shrink-0 ${methodBadge.color}`}
        >
          {methodBadge.icon}
        </span>
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
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] select-none ${
        isDragging ? "opacity-30" : "opacity-100"
      } ${
        isSelected || (isActive && !isDropTarget) ? "bg-th-accent-bg" : !isDropTarget ? "hover:bg-th-hover" : ""
      } ${
        dropPos === "before" ? "border-t-2 border-th-accent" : ""
      } ${
        dropPos === "after" ? "border-b-2 border-th-accent" : ""
      }`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { if (getSuppressNextClick()) return; if (!onItemClick(node.id, e)) return; openTab(node.id); }}
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
