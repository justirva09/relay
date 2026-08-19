import React, { useMemo, useState } from "react";
import { TreeNode, FolderNode } from "../types";
import { collectLeafIds } from "../lib/treeFilter";
import { METHOD_COLOR } from "./Sidebar";

type FolderCheckState = "all" | "none" | "partial";

function folderLeafIds(folder: FolderNode): string[] {
  return collectLeafIds(folder.children);
}

function folderState(folder: FolderNode, selected: Set<string>): FolderCheckState {
  const ids = folderLeafIds(folder);
  if (ids.length === 0) return "none";
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  if (selectedCount === 0) return "none";
  if (selectedCount === ids.length) return "all";
  return "partial";
}

function TriStateCheckbox({ state, onChange }: { state: FolderCheckState; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "partial";
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="accent-th-accent shrink-0"
    />
  );
}

function Row({
  node,
  depth,
  selected,
  onToggleLeaf,
  onToggleFolder,
}: {
  node: TreeNode;
  depth: number;
  selected: Set<string>;
  onToggleLeaf: (id: string) => void;
  onToggleFolder: (folder: FolderNode) => void;
}) {
  const padding = depth * 16 + 8;

  if (node.kind === "folder") {
    const state = folderState(node, selected);
    return (
      <>
        <div
          className="flex items-center gap-2 py-1.5 px-2 text-[12.5px] text-th-text-2 hover:bg-th-hover rounded cursor-pointer"
          style={{ paddingLeft: padding }}
          onClick={() => onToggleFolder(node)}
        >
          <TriStateCheckbox state={state} onChange={() => onToggleFolder(node)} />
          <span className="font-medium truncate">{node.name}</span>
        </div>
        {node.children.map((child) => (
          <Row key={child.id} node={child} depth={depth + 1} selected={selected} onToggleLeaf={onToggleLeaf} onToggleFolder={onToggleFolder} />
        ))}
      </>
    );
  }

  const label = node.kind === "grpc" ? "gRPC" : node.request.method;
  const color = node.kind === "grpc" ? "text-indigo-300" : METHOD_COLOR[node.request.method] || "text-th-text-3";
  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 text-[12.5px] text-th-text-2 hover:bg-th-hover rounded cursor-pointer"
      style={{ paddingLeft: padding + 20 }}
      onClick={() => onToggleLeaf(node.id)}
    >
      <input
        type="checkbox"
        checked={selected.has(node.id)}
        onChange={() => onToggleLeaf(node.id)}
        onClick={(e) => e.stopPropagation()}
        className="accent-th-accent shrink-0"
      />
      <span className={`font-mono text-[10.5px] font-bold w-9 shrink-0 ${color}`}>{label}</span>
      <span className="truncate">{node.name}</span>
    </div>
  );
}

export default function TreePickerModal({
  tree,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  tree: TreeNode[];
  title: string;
  confirmLabel: string;
  onConfirm: (selectedIds: Set<string>) => void;
  onCancel: () => void;
}) {
  const allLeafIds = useMemo(() => collectLeafIds(tree), [tree]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allLeafIds));

  const toggleLeaf = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolder = (folder: FolderNode) => {
    const ids = folderLeafIds(folder);
    const state = folderState(folder, selected);
    setSelected((prev) => {
      const next = new Set(prev);
      if (state === "all") ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allLeafIds));
  const selectNone = () => setSelected(new Set());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onCancel}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[440px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-th-border flex items-center justify-between shrink-0">
          <span className="text-[13.5px] font-semibold text-th-text-1">{title}</span>
          <div className="flex gap-3 text-[11.5px]">
            <button className="text-th-accent-text hover:underline" onClick={selectAll}>
              Select all
            </button>
            <button className="text-th-accent-text hover:underline" onClick={selectNone}>
              Select none
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {tree.length === 0 ? (
            <p className="text-[12.5px] text-th-text-3 italic px-4 py-6 text-center">Nothing to show.</p>
          ) : (
            tree.map((node) => (
              <Row key={node.id} node={node} depth={0} selected={selected} onToggleLeaf={toggleLeaf} onToggleFolder={toggleFolder} />
            ))
          )}
        </div>
        <div className="px-4 py-3 border-t border-th-border flex items-center justify-between shrink-0">
          <span className="text-[11.5px] text-th-text-3">
            {selected.size} of {allLeafIds.length} selected
          </span>
          <div className="flex gap-2">
            <button className="text-[12.5px] px-3 py-1.5 rounded text-th-text-2 hover:bg-th-hover" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="text-[12.5px] px-3 py-1.5 rounded bg-th-accent text-white disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selected.size === 0}
              onClick={() => onConfirm(selected)}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
