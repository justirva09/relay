import { Dispatch, SetStateAction, useCallback } from "react";
import { FolderNode, GrpcMethodType, GrpcRequestNode, RequestData, RequestNode, TabState, TreeNode, Workspace, defaultGrpcRequest, defaultRequest, uid } from "../types";
import { cloneWithFreshIds, findNode, findParentFolderId, insertAt, mapTree } from "./treeOps";

export interface GrpcApiImportService {
  name: string;
  methods: { name: string; methodType: GrpcMethodType; template: string }[];
}

function streamTemplate(template: string, methodType: GrpcMethodType): string {
  if (methodType !== "client-stream" && methodType !== "bidi") return template;
  return `[\n${template.split("\n").map((line) => `  ${line}`).join("\n")}\n]`;
}

export function useTreeActions(
  workspace: Workspace,
  setWorkspace: Dispatch<SetStateAction<Workspace>>,
  setTabs: Dispatch<SetStateAction<TabState[]>>,
  setActiveTabId: Dispatch<SetStateAction<string | null>>
) {
  const addFolder = useCallback(
    (parentId: string | null) => {
      const node: FolderNode = { id: uid(), kind: "folder", name: "New Folder", children: [] };
      setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, node) }));
      return node.id;
    },
    [setWorkspace]
  );

  const addRequest = useCallback(
    (parentId: string | null, preset?: { name: string; request: RequestData }) => {
      const node: RequestNode = {
        id: uid(),
        kind: "request",
        name: preset?.name || "New Request",
        request: preset?.request ?? defaultRequest("GET", ""),
      };
      setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, node) }));
      return node.id;
    },
    [setWorkspace]
  );

  const addGrpcRequest = useCallback(
    (parentId: string | null) => {
      const node: GrpcRequestNode = { id: uid(), kind: "grpc", name: "New gRPC Request", request: defaultGrpcRequest() };
      setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, node) }));
      return node.id;
    },
    [setWorkspace]
  );

  const importGrpcApi = useCallback(
    (parentId: string | null, apiName: string, url: string, services: GrpcApiImportService[]) => {
      const shortNames = services.map((service) => service.name.split(".").pop() || service.name);
      const duplicateShortNames = new Set(shortNames.filter((name, index) => shortNames.indexOf(name) !== index));
      let requestCount = 0;
      const apiFolder: FolderNode = {
        id: uid(),
        kind: "folder",
        name: apiName,
        children: services.map((service) => {
          const shortName = service.name.split(".").pop() || service.name;
          const serviceFolder: FolderNode = {
            id: uid(),
            kind: "folder",
            name: duplicateShortNames.has(shortName) ? service.name : shortName,
            children: service.methods.map((method) => {
              requestCount += 1;
              const node: GrpcRequestNode = {
                id: uid(),
                kind: "grpc",
                name: method.name,
                request: {
                  ...defaultGrpcRequest(url),
                  service: service.name,
                  method: method.name,
                  methodType: method.methodType,
                  messageJson: streamTemplate(method.template, method.methodType),
                },
              };
              return node;
            }),
          };
          return serviceFolder;
        }),
      };
      setWorkspace((ws) => {
        const parent = parentId ? findNode(ws.tree, parentId) : null;
        const siblings = parent?.kind === "folder" ? parent.children : ws.tree;
        const siblingNames = new Set(siblings.map((node) => node.name.toLowerCase()));
        let uniqueName = apiName;
        let suffix = 2;
        while (siblingNames.has(uniqueName.toLowerCase())) uniqueName = `${apiName} (${suffix++})`;
        return { ...ws, tree: insertAt(ws.tree, parentId, { ...apiFolder, name: uniqueName }) };
      });
      return { folderId: apiFolder.id, requestCount };
    },
    [setWorkspace]
  );

  const renameNode = useCallback(
    (id: string, name: string) => {
      setWorkspace((ws) => ({
        ...ws,
        tree: mapTree(ws.tree, id, (n) => ({ ...n, name }) as TreeNode),
      }));
    },
    [setWorkspace]
  );

  const duplicateNode = useCallback(
    (id: string): string | null => {
      const original = findNode(workspace.tree, id);
      if (!original) return null;
      const parentId = findParentFolderId(workspace.tree, id);
      const clone = { ...cloneWithFreshIds(original), name: `${original.name} copy` };
      setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, clone) }));
      return clone.id;
    },
    [workspace.tree, setWorkspace]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setWorkspace((ws) => ({ ...ws, tree: mapTree(ws.tree, id, () => null) }));
      setTabs((t) => t.filter((tab) => tab.nodeId !== id));
      setActiveTabId((cur) => (cur === id ? null : cur));
    },
    [setWorkspace, setTabs, setActiveTabId]
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const remove = (nodes: TreeNode[]): TreeNode[] => {
        const out: TreeNode[] = [];
        for (const n of nodes) {
          if (idSet.has(n.id)) continue;
          out.push(n.kind === "folder" ? { ...n, children: remove(n.children) } : n);
        }
        return out;
      };
      setWorkspace((ws) => ({ ...ws, tree: remove(ws.tree) }));
      setTabs((t) => t.filter((tab) => !idSet.has(tab.nodeId)));
      setActiveTabId((cur) => (cur && idSet.has(cur) ? null : cur));
    },
    [setWorkspace, setTabs, setActiveTabId]
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      setWorkspace((ws) => ({
        ...ws,
        tree: mapTree(ws.tree, id, (n) => (n.kind === "folder" ? { ...n, collapsed: !n.collapsed } : n)),
      }));
    },
    [setWorkspace]
  );

  const collapseAllFolders = useCallback(() => {
    const collapseAll = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => (n.kind === "folder" ? { ...n, collapsed: true, children: collapseAll(n.children) } : n));
    setWorkspace((ws) => ({ ...ws, tree: collapseAll(ws.tree) }));
  }, [setWorkspace]);

  const moveNodes = useCallback(
    (nodeIds: string[], targetId: string, position: "before" | "after" | "inside") => {
      setWorkspace((ws) => {
        const idSet = new Set(nodeIds.filter((id) => id !== targetId));
        if (idSet.size === 0) return ws;

        // Never drop a folder into its own descendant, checked against every dragged node.
        const hasDescendant = (nodes: TreeNode[], id: string): boolean => {
          for (const n of nodes) {
            if (n.id === id) return true;
            if (n.kind === "folder" && hasDescendant(n.children, id)) return true;
          }
          return false;
        };
        for (const id of idSet) {
          const drag = findNode(ws.tree, id);
          if (drag?.kind === "folder" && hasDescendant((drag as FolderNode).children, targetId)) return ws;
        }

        // Collect dragged nodes in their original tree order (not selection-click order)
        // so a multi-select drag preserves relative ordering at the destination.
        const removed: TreeNode[] = [];
        const remove = (nodes: TreeNode[]): TreeNode[] => {
          const out: TreeNode[] = [];
          for (const n of nodes) {
            if (idSet.has(n.id)) {
              removed.push(n);
              continue;
            }
            out.push(n.kind === "folder" ? { ...n, children: remove(n.children) } : n);
          }
          return out;
        };
        let tree = remove(ws.tree);
        if (removed.length === 0) return ws;

        if (position === "inside") {
          const insert = (nodes: TreeNode[]): TreeNode[] =>
            nodes.map((n) =>
              n.id === targetId && n.kind === "folder"
                ? { ...n, children: [...n.children, ...removed], collapsed: false }
                : n.kind === "folder"
                ? { ...n, children: insert(n.children) }
                : n
            );
          return { ...ws, tree: insert(tree) };
        }

        const insertAdj = (nodes: TreeNode[]): TreeNode[] => {
          const out: TreeNode[] = [];
          for (const n of nodes) {
            if (n.id === targetId) {
              if (position === "before") out.push(...removed);
              out.push(n.kind === "folder" ? { ...n, children: insertAdj(n.children) } : n);
              if (position === "after") out.push(...removed);
            } else {
              out.push(n.kind === "folder" ? { ...n, children: insertAdj(n.children) } : n);
            }
          }
          return out;
        };
        return { ...ws, tree: insertAdj(tree) };
      });
    },
    [setWorkspace]
  );

  const setProtoLibrary = useCallback(
    (files: { name: string; content: string }[]) => {
      setWorkspace((ws) => ({ ...ws, protoLibrary: files }));
    },
    [setWorkspace]
  );

  return {
    addFolder,
    addRequest,
    addGrpcRequest,
    importGrpcApi,
    renameNode,
    duplicateNode,
    deleteNode,
    deleteNodes,
    toggleCollapse,
    collapseAllFolders,
    moveNodes,
    setProtoLibrary,
  };
}
