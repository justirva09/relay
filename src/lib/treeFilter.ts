import { TreeNode } from "../types";

export function collectLeafIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.kind === "folder") ids.push(...collectLeafIds(n.children));
    else ids.push(n.id);
  }
  return ids;
}

// Prunes a tree down to only the selected leaves (requests/gRPC calls),
// keeping any ancestor folder that still has at least one selected
// descendant so the resulting shape stays a valid, non-empty-folder tree.
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
