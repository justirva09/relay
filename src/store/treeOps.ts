import { TreeNode, uid } from "../types";

export function mapTree(nodes: TreeNode[], id: string, fn: (n: TreeNode) => TreeNode | null): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.id === id) {
      const replaced = fn(n);
      if (replaced) out.push(replaced);
      continue;
    }
    if (n.kind === "folder") {
      out.push({ ...n, children: mapTree(n.children, id, fn) });
    } else {
      out.push(n);
    }
  }
  return out;
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === "folder") {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParentFolderId(nodes: TreeNode[], childId: string, parentId: string | null = null): string | null {
  for (const n of nodes) {
    if (n.id === childId) return parentId;
    if (n.kind === "folder") {
      const found = findParentFolderId(n.children, childId, n.id);
      if (found !== null) return found;
    }
  }
  return null;
}

export function cloneWithFreshIds(node: TreeNode): TreeNode {
  if (node.kind === "folder") {
    return { ...node, id: uid(), children: node.children.map(cloneWithFreshIds) };
  }
  return { ...node, id: uid() };
}

export function insertAt(nodes: TreeNode[], parentId: string | null, node: TreeNode): TreeNode[] {
  if (parentId === null) return [...nodes, node];
  return nodes.map((n) => {
    if (n.kind === "folder" && n.id === parentId) return { ...n, children: [...n.children, node] };
    if (n.kind === "folder") return { ...n, children: insertAt(n.children, parentId, node) };
    return n;
  });
}
