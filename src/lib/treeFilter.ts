import { TreeNode } from "../types";

export function collectLeafIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.kind === "folder") ids.push(...collectLeafIds(n.children));
    else ids.push(n.id);
  }
  return ids;
}

// keeps ancestor folders that still have a selected descendant, drops empty ones
export function filterTreeBySelection(nodes: TreeNode[], selectedLeafIds: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === "folder") {
      const children = filterTreeBySelection(n.children, selectedLeafIds);
      if (children.length > 0) out.push({ ...n, children });
    } else if (selectedLeafIds.has(n.id)) {
      out.push(n);
    }
  }
  return out;
}
