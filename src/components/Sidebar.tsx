import React, { useState, useEffect, useRef, useMemo, useDeferredValue } from "react";
import { GrpcRequestNode, TreeNode } from "../types";
import { useWorkspace } from "../store";
import CurlImportModal from "./CurlImportModal";
import GrpcReflectionImportModal from "./grpc/GrpcReflectionImportModal";
import GrpcMethodInfoModal from "./grpc/GrpcMethodInfoModal";
import { registerAction, setActiveSearchRegion } from "../lib/keybindings";
import { useLayout } from "../lib/layout";
import { TreeItem } from "./sidebar/TreeItem";
import { AddRequestDropdown } from "./sidebar/AddRequestDropdown";
import { DropInfo, setSuppressNextClick } from "./sidebar/shared";
import { workspaceVariableValues } from "../lib/pm";

export { METHOD_COLOR } from "./sidebar/shared";

interface CtxMenuState {
  x: number;
  y: number;
  nodeId: string;
  kind: "folder" | "request" | "grpc";
}

// Rendered order, skipping children of collapsed folders. Used for shift-click ranges.
function flattenVisible(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.id);
    if (n.kind === "folder" && !n.collapsed) out.push(...flattenVisible(n.children));
  }
  return out;
}

// Pruned tree: only nodes matching query, plus folders needed to reach them,
// force-expanded. A folder matching by name keeps its whole subtree as-is.
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === "folder") {
      const selfMatches = n.name.toLowerCase().includes(query);
      const filteredChildren = selfMatches ? n.children : filterTree(n.children, query);
      if (selfMatches || filteredChildren.length > 0) {
        out.push({ ...n, collapsed: false, children: filteredChildren });
      }
    } else if (n.name.toLowerCase().includes(query)) {
      out.push(n);
    }
  }
  return out;
}

type SidebarMode = "all" | "http" | "grpc";
interface VisibleRow { node: TreeNode; depth: number }
const ROW_HEIGHT = 32;
const ROW_OVERSCAN = 8;

function filterByMode(nodes: TreeNode[], mode: SidebarMode): TreeNode[] {
  if (mode === "all") return nodes;
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      const children = filterByMode(node.children, mode);
      if (children.length || node.children.length === 0) out.push({ ...node, children });
    } else if ((mode === "http" && node.kind === "request") || (mode === "grpc" && node.kind === "grpc")) {
      out.push(node);
    }
  }
  return out;
}

function flattenRows(nodes: TreeNode[], depth = 0, rows: VisibleRow[] = []): VisibleRow[] {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "folder" && !node.collapsed) flattenRows(node.children, depth + 1, rows);
  }
  return rows;
}

function VirtualTree({ rows, scrollRef, onClearSelection, renderRow, emptyMessage }: {
  rows: VisibleRow[];
  scrollRef: React.RefObject<HTMLDivElement>;
  onClearSelection: () => void;
  renderRow: (row: VisibleRow) => React.ReactNode;
  emptyMessage: string;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [scrollRef]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + ROW_OVERSCAN);
  return <div
    ref={scrollRef}
    className="flex-1 min-h-0 overflow-auto"
    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    onClick={(event) => { if (!(event.target as HTMLElement).closest("[data-tree-id]")) onClearSelection(); }}
  >
    {rows.length === 0 ? <div className="px-3 py-3 text-[12px] text-th-text-4 font-mono">{emptyMessage}</div> :
      <div className="relative" style={{ height: rows.length * ROW_HEIGHT + 16 }}>
        {rows.slice(start, end).map((row, offset) =>
          <div key={row.node.id} className="absolute left-0 right-0" style={{ top: (start + offset) * ROW_HEIGHT + 8, height: ROW_HEIGHT }}>
            {renderRow(row)}
          </div>
        )}
      </div>}
  </div>;
}

function SidebarSearch({ inputRef, onSearch, mode }: { inputRef: React.RefObject<HTMLInputElement>; onSearch: (query: string) => void; mode: SidebarMode }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(value), 150);
    return () => window.clearTimeout(timer);
  }, [value, onSearch]);
  return <div className="relative w-full">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2 top-1/2 -translate-y-1/2 text-th-text-3 pointer-events-none"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
    <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} placeholder={mode === "all" ? "Search requests…" : `Search ${mode === "http" ? "HTTP" : "gRPC"}…`} className="w-full bg-transparent border-none pl-7 pr-6 py-1.5 text-[12px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none" />
    {value && <button onClick={() => { setValue(""); onSearch(""); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-th-text-3 hover:text-th-text-1 text-[13px] leading-none" aria-label="Clear search">×</button>}
  </div>;
}

const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 560;
const SIDEBAR_DEFAULT = 300;

export default function Sidebar() {
  const { workspace, addFolder, addRequest, addGrpcRequest, importGrpcApi, duplicateNode, deleteNodes, moveNodes, renameWorkspace, collapseAllFolders, importIntoFolder, openTab, curlImportOpen, curlImportParentId, openCurlImport, closeCurlImport } = useWorkspace();
  const { sidebarCollapsed } = useLayout();
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [triggerEditId, setTriggerEditId] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [grpcImportTarget, setGrpcImportTarget] = useState<{ parentId: string | null } | null>(null);
  const [grpcInfoNode, setGrpcInfoNode] = useState<GrpcRequestNode | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<SidebarMode>(() => {
    const stored = localStorage.getItem("relay-sidebar-mode");
    return stored === "http" || stored === "grpc" ? stored : "all";
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<DropInfo | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("relay-sidebar-width"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);

  const changeMode = (next: SidebarMode) => {
    if (next === mode) return;
    setMode(next);
    localStorage.setItem("relay-sidebar-mode", next);
    setSearchQuery("");
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setCtxMenu(null);
    if (treeScrollRef.current) treeScrollRef.current.scrollTop = 0;
  };

  useEffect(() => {
    const unregisters = [
      registerAction("request.new", () => {
        const id = addRequest(null);
        openTab(id);
      }),
      registerAction("request.newFolder", () => addFolder(null)),
      registerAction("sidebar.search", () => searchInputRef.current?.focus()),
      registerAction("sidebar.duplicate", () => {
        if (selectedIds.size === 1) duplicateNode([...selectedIds][0]);
      }),
    ];
    return () => unregisters.forEach((u) => u());
  }, [addRequest, addFolder, openTab, duplicateNode, selectedIds]);

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

  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ nodeId: string; y: number } | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const dropInfoRef = useRef<DropInfo | null>(null);
  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  dragIdRef.current = dragId;
  dropInfoRef.current = dropInfo;
  selectedIdsRef.current = selectedIds;

  // Dragging one item in an active multi-selection moves the whole group.
  const draggingIds = dragId ? (selectedIds.has(dragId) && selectedIds.size > 1 ? selectedIds : new Set([dragId])) : null;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;

      if (!dragIdRef.current && Math.abs(e.clientY - start.y) < 5) return;

      if (!dragIdRef.current) {
        setDragId(start.nodeId);
        dragIdRef.current = start.nodeId;
        setSuppressNextClick(true);
      }

      setDragCursor({ x: e.clientX, y: e.clientY });

      const scrollElement = treeScrollRef.current;
      if (scrollElement) {
        const bounds = scrollElement.getBoundingClientRect();
        if (e.clientX >= bounds.left && e.clientX <= bounds.right) {
          if (e.clientY < bounds.top + 32 && e.clientY >= bounds.top) scrollElement.scrollTop -= 20;
          else if (e.clientY > bounds.bottom - 32 && e.clientY <= bounds.bottom) scrollElement.scrollTop += 20;
        }
      }

      const movingIds =
        selectedIdsRef.current.has(start.nodeId) && selectedIdsRef.current.size > 1
          ? selectedIdsRef.current
          : new Set([start.nodeId]);

      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-tree-id]") as HTMLElement | null;
      if (!el || movingIds.has(el.dataset.treeId!)) {
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
        const movingIds = selectedIdsRef.current.has(did) && selectedIdsRef.current.size > 1 ? Array.from(selectedIdsRef.current) : [did];
        moveNodes(movingIds, di.id, di.position);
      }
      dragStartRef.current = null;
      setDragId(null);
      setDropInfo(null);
      setDragCursor(null);
      dragIdRef.current = null;
      dropInfoRef.current = null;
      setTimeout(() => setSuppressNextClick(false), 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [moveNodes]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  const handleItemMouseDown = (nodeId: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
      setLastSelectedId(nodeId);
      return;
    }
    if (e.shiftKey) {
      const order = flattenVisible(displayTree);
      const anchor = lastSelectedId ?? nodeId;
      const ai = order.indexOf(anchor);
      const bi = order.indexOf(nodeId);
      setSelectedIds(ai === -1 || bi === -1 ? new Set([nodeId]) : new Set(order.slice(Math.min(ai, bi), Math.max(ai, bi) + 1)));
      return;
    }
    // Keep the group selected so a following drag moves it all together.
    setSelectedIds((prev) => (prev.has(nodeId) && prev.size > 1 ? prev : new Set([nodeId])));
    setLastSelectedId(nodeId);
    dragStartRef.current = { nodeId, y: e.clientY };
  };

  // Modifier-clicks are selection-only (mousedown already handled them),
  // so skip the default open/collapse action for those.
  const handleItemClick = (nodeId: string, e: React.MouseEvent): boolean => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return false;
    setSelectedIds(new Set([nodeId]));
    setLastSelectedId(nodeId);
    return true;
  };

  const deferredQuery = useDeferredValue(searchQuery);
  const trimmedQuery = deferredQuery.trim().toLowerCase();
  const displayTree = useMemo(
    () => {
      const matchingType = filterByMode(workspace.tree, mode);
      return trimmedQuery ? filterTree(matchingType, trimmedQuery) : matchingType;
    },
    [workspace.tree, mode, trimmedQuery]
  );
  const rows = useMemo(() => flattenRows(displayTree), [displayTree]);

  useEffect(() => {
    if (!triggerEditId || !treeScrollRef.current) return;
    const index = rows.findIndex((row) => row.node.id === triggerEditId);
    if (index < 0) return;
    const element = treeScrollRef.current;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - Math.floor(element.clientHeight / 2));
    }
  }, [triggerEditId, rows]);

  const handleCtxMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-click on a non-selected item resets to single selection; on a
    // selected item, keep the group so the menu can offer bulk actions.
    if (!(selectedIds.has(node.id) && selectedIds.size > 1)) {
      setSelectedIds(new Set([node.id]));
      setLastSelectedId(node.id);
    }
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
    <div
      className={`relative shrink-0 border-r border-th-border bg-th-sidebar flex flex-col h-full overflow-hidden ${
        resizing ? "" : "transition-[width] duration-200 ease-in-out"
      }`}
      style={{ width: sidebarCollapsed ? 0 : width }}
      onMouseEnter={() => setActiveSearchRegion("sidebar")}
    >
      <nav className="absolute inset-y-0 left-0 w-11 border-r border-th-border bg-th-bg/45 flex flex-col items-center pt-2 gap-1" aria-label="Request type">
        {(["all", "http", "grpc"] as const).map((item) => (
          <button
            key={item}
            type="button"
            title={item === "all" ? "All requests" : item === "http" ? "HTTP requests" : "gRPC requests"}
            aria-label={item === "all" ? "All requests" : item === "http" ? "HTTP requests" : "gRPC requests"}
            aria-pressed={mode === item}
            onClick={() => changeMode(item)}
            className={`relative w-9 h-10 rounded-md flex flex-col items-center justify-center gap-0.5 transition-colors ${mode === item ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-3 hover:text-th-text-1 hover:bg-th-hover"}`}
          >
            {mode === item && <span className="absolute -left-1 top-2 bottom-2 w-0.5 rounded-full bg-th-accent" />}
            {item === "all" ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
            ) : item === "http" ? (
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c-2 2-3 4.3-3 7s1 5 3 7c2-2 3-4.3 3-7s-1-5-3-7Z" /></svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2" y="7" width="5" height="6" rx="1" /><rect x="13" y="7" width="5" height="6" rx="1" /><path d="M7 9h6m0 0-2-2m2 2-2 2M13 12H7m0 0 2-2m-2 2 2 2" /></svg>
            )}
            <span className="text-[9px] font-semibold leading-none">{item === "all" ? "All" : item === "http" ? "HTTP" : "gRPC"}</span>
          </button>
        ))}
      </nav>
      <div className="ml-11 h-full min-w-0 flex flex-col">
      <div className="h-9 px-3 flex items-center justify-between border-b border-th-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => { renameWorkspace(titleDraft); setEditingTitle(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { renameWorkspace(titleDraft); setEditingTitle(false); }
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="text-[12.5px] font-mono text-th-text-1 tracking-wide bg-th-bg border border-th-border-focus rounded px-1.5 py-0.5 min-w-0 w-full"
            />
          ) : (
            <span
              title="Double-click to rename"
              onDoubleClick={() => { setTitleDraft(workspace.name); setEditingTitle(true); }}
              className="text-[12.5px] font-mono text-th-text-2 tracking-wide truncate cursor-text"
            >
              {workspace.name || "Collections"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <AddRequestDropdown
            title="New request"
            onAddHttp={() => {
              changeMode("http");
              const id = addRequest(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            onAddGrpc={() => {
              changeMode("grpc");
              const id = addGrpcRequest(null);
              if (id) setTimeout(() => setTriggerEditId(id), 50);
            }}
            onImportGrpc={() => { changeMode("grpc"); setGrpcImportTarget({ parentId: null }); }}
            onAddFromCurl={() => { changeMode("http"); openCurlImport(null); }}
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
          <button
            title="Collapse all folders"
            onClick={() => collapseAllFolders()}
            className="h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 13 12 18 17 13" />
              <polyline points="7 6 12 11 17 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="h-10 px-3 flex items-center border-b border-th-border shrink-0">
        <SidebarSearch key={mode} inputRef={searchInputRef} onSearch={setSearchQuery} mode={mode} />
      </div>

      <VirtualTree
        key={mode}
        rows={rows}
        scrollRef={treeScrollRef}
        onClearSelection={() => setSelectedIds(new Set())}
        emptyMessage={trimmedQuery ? "No matching requests" : mode === "all" ? "No collections yet" : `No ${mode === "http" ? "HTTP" : "gRPC"} requests yet`}
        renderRow={({ node, depth }) => (
          <TreeItem key={node.id} node={node} depth={depth} flat onCtxMenu={handleCtxMenu} triggerEditId={triggerEditId} clearTriggerEdit={() => setTriggerEditId(null)} onDelete={(id) => setPendingDeleteIds([id])} draggingIds={draggingIds} dropInfo={dropInfo} selectedIds={selectedIds} onItemMouseDown={handleItemMouseDown} onItemClick={handleItemClick} onAddFromCurl={(parentId) => { changeMode("http"); openCurlImport(parentId); }} onImportGrpc={(parentId) => { changeMode("grpc"); setGrpcImportTarget({ parentId }); }} onInspectGrpc={setGrpcInfoNode} onCreateKind={changeMode} />
        )}
      />


      {dragCursor && draggingIds && draggingIds.size > 1 && (
        <div
          className="fixed z-50 pointer-events-none bg-th-accent text-white text-[11px] font-mono font-medium rounded-full px-2 py-0.5 shadow-lg"
          style={{ left: dragCursor.x + 14, top: dragCursor.y + 10 }}
        >
          {draggingIds.size} items
        </div>
      )}

      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-th-elevated border border-th-border rounded-md shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {selectedIds.size > 1 && selectedIds.has(ctxMenu.nodeId) ? (
            <button
              onClick={() => {
                setPendingDeleteIds(Array.from(selectedIds));
                setCtxMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left text-[12.5px] text-rose-400 hover:bg-rose-400/10"
            >
              Delete {selectedIds.size} items
            </button>
          ) : (
            <>
              {ctxMenu.kind === "folder" && (
                <>
                  <button
                    onClick={() => {
                      changeMode("http");
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
                      changeMode("grpc");
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
                      changeMode("grpc");
                      setGrpcImportTarget({ parentId: ctxMenu.nodeId });
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
                  >
                    Import gRPC API
                  </button>
                  <button
                    onClick={() => {
                      changeMode("http");
                      openCurlImport(ctxMenu.nodeId);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
                  >
                    New Request From cURL
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
                  <button
                    onClick={() => {
                      importIntoFolder(ctxMenu.nodeId);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
                  >
                    Import Here
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
                  duplicateNode(ctxMenu.nodeId);
                  setCtxMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-th-text-1 hover:bg-th-hover"
              >
                Duplicate
              </button>
              <button
                onClick={() => {
                  setPendingDeleteIds([ctxMenu.nodeId]);
                  setCtxMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] text-rose-400 hover:bg-rose-400/10"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {pendingDeleteIds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={() => setPendingDeleteIds(null)}>
          <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[340px] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-semibold text-th-text-1 mb-2">Delete</h3>
            <p className="text-[13px] text-th-text-2 mb-5">
              {pendingDeleteIds.length === 1 ? (
                <>Delete <span className="text-th-text-1 font-mono">"{findName(pendingDeleteIds[0])}"</span>? This cannot be undone.</>
              ) : (
                <>Delete <span className="text-th-text-1 font-mono">{pendingDeleteIds.length} items</span>? This cannot be undone.</>
              )}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDeleteIds(null)}
                className="px-3 py-1.5 rounded text-[12.5px] text-th-text-2 hover:text-th-text-1 hover:bg-th-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const ids = pendingDeleteIds;
                  setPendingDeleteIds(null);
                  deleteNodes(ids);
                }}
                className="px-3 py-1.5 rounded text-[12.5px] bg-rose-500 text-white hover:bg-rose-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {curlImportOpen && (
        <CurlImportModal
          onClose={closeCurlImport}
          onCreate={(name, request) => {
            const id = addRequest(curlImportParentId, { name, request });
            closeCurlImport();
            if (id) openTab(id);
          }}
        />
      )}

      {grpcImportTarget && (
        <GrpcReflectionImportModal
          variableValues={workspaceVariableValues(workspace)}
          onClose={() => setGrpcImportTarget(null)}
          onImport={(apiName, url, services) => {
            importGrpcApi(grpcImportTarget.parentId, apiName, url, services);
            setGrpcImportTarget(null);
          }}
        />
      )}

      {grpcInfoNode && <GrpcMethodInfoModal request={grpcInfoNode.request} onClose={() => setGrpcInfoNode(null)} />}

      </div>

      <div
        onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
        className={`absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-th-accent-border ${resizing ? "bg-th-accent-border" : ""}`}
        style={{ transform: "translateX(50%)" }}
      />
    </div>
  );
}
