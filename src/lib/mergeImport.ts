import { TreeNode, RequestNode, KVRow, newRow, uid } from "../types";

export interface MergeResult {
  tree: TreeNode[];
  added: number;
  updated: number;
}

// Path of folder names from root to the given folder, so a targeted
// "import into this folder" can root new requests there instead of at root.
export function findFolderPath(tree: TreeNode[], folderId: string, path: string[] = []): string[] | null {
  for (const n of tree) {
    if (n.kind !== "folder") continue;
    if (n.id === folderId) return [...path, n.name];
    const found = findFolderPath(n.children, folderId, [...path, n.name]);
    if (found) return found;
  }
  return null;
}

function normalizeUrl(url: string): string {
  const qIndex = url.indexOf("?");
  const path = qIndex === -1 ? url : url.slice(0, qIndex);
  return path.replace(/\/+$/, "");
}

function requestKey(n: RequestNode): string {
  return `${n.request.method}:${normalizeUrl(n.request.url)}`;
}

function indexRequests(nodes: TreeNode[], out: Map<string, RequestNode>) {
  for (const n of nodes) {
    if (n.kind === "folder") indexRequests(n.children, out);
    else if (n.kind === "request") out.set(requestKey(n), n);
  }
}

function unionHeaders(existingRows: KVRow[], incomingRows: KVRow[]): KVRow[] {
  const incomingKeys = new Set(incomingRows.filter((r) => r.key.trim()).map((r) => r.key.trim().toLowerCase()));
  const extra = existingRows.filter((r) => r.key.trim() && !incomingKeys.has(r.key.trim().toLowerCase()));
  const merged = [...incomingRows.filter((r) => r.key.trim()), ...extra];
  merged.push(newRow());
  return merged;
}

function mergeRequestNode(existing: RequestNode, incoming: RequestNode): RequestNode {
  return {
    ...existing,
    request: {
      ...existing.request,
      method: incoming.request.method,
      url: incoming.request.url,
      description: incoming.request.description,
      params: incoming.request.params,
      pathParams: incoming.request.pathParams,
      headers: unionHeaders(existing.request.headers, incoming.request.headers),
      auth: incoming.request.auth,
      bodyMode: incoming.request.bodyMode,
      bodyText: incoming.request.bodyText,
      bodyForm: incoming.request.bodyForm,
      bodyUrlencoded: incoming.request.bodyUrlencoded,
    },
  };
}

function insertByPath(tree: TreeNode[], path: string[], node: TreeNode): TreeNode[] {
  if (path.length === 0) return [...tree, node];
  const [head, ...rest] = path;
  const idx = tree.findIndex((n) => n.kind === "folder" && n.name.toLowerCase() === head.toLowerCase());
  if (idx === -1) {
    return [...tree, { id: uid(), kind: "folder", name: head, children: insertByPath([], rest, node) }];
  }
  const folder = tree[idx];
  if (folder.kind !== "folder") return [...tree, node];
  const updatedFolder = { ...folder, children: insertByPath(folder.children, rest, node) };
  return [...tree.slice(0, idx), updatedFolder, ...tree.slice(idx + 1)];
}

// Re-importing the same spec updates existing requests in place (matched by
// method + URL) instead of appending duplicates. preScript/testScript and
// name/folder position are never overwritten. Unmatched incoming requests
// get inserted new. Existing requests missing from the spec are left alone,
// sync only adds/updates, never deletes.
export function mergeIncomingTree(existingTree: TreeNode[], incomingTree: TreeNode[], basePath: string[] = []): MergeResult {
  const incomingByKey = new Map<string, RequestNode>();
  indexRequests(incomingTree, incomingByKey);

  const matchedKeys = new Set<string>();
  let updated = 0;

  function applyToExisting(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((n) => {
      if (n.kind === "folder") return { ...n, children: applyToExisting(n.children) };
      if (n.kind !== "request") return n;
      const key = requestKey(n);
      const incoming = incomingByKey.get(key);
      if (!incoming) return n;
      matchedKeys.add(key);
      updated++;
      return mergeRequestNode(n, incoming);
    });
  }

  let tree = applyToExisting(existingTree);

  const newLeaves: { path: string[]; node: TreeNode }[] = [];
  function collectNew(nodes: TreeNode[], path: string[]) {
    for (const n of nodes) {
      if (n.kind === "folder") {
        collectNew(n.children, [...path, n.name]);
        continue;
      }
      if (n.kind !== "request") continue;
      if (matchedKeys.has(requestKey(n))) continue;
      newLeaves.push({ path: [...basePath, ...path], node: n });
    }
  }
  collectNew(incomingTree, []);

  for (const leaf of newLeaves) {
    tree = insertByPath(tree, leaf.path, leaf.node);
  }

  return { tree, added: newLeaves.length, updated };
}
