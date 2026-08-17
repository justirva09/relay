import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Environment, FolderNode, GrpcLogEntry, GrpcRequestData, GrpcRequestNode, GrpcResponseSummary, GrpcTabState, HttpTabState, KVRow, RequestData, RequestNode, ResponseState, TabState, TreeNode, Workspace, defaultGrpcRequest, defaultRequest, demoWorkspace, newRow, normalizeRequestData, uid } from "./types";
import { loadWorkspaceFile, pickCollectionFile, pickSavePath, readFileAtPath, writeFileAtPath, pickWorkspaceFolder, getLastWorkspaceDir, setLastWorkspaceDir, loadWorkspaceDir, saveWorkspaceDir, dirHasOtherFiles, loadResponseCache, saveResponseCache } from "./lib/tauri";
import { runRequest } from "./lib/useSendRequest";
import { isPostmanCollection, isRelayWorkspace, postmanToTree, treeToPostman } from "./lib/postman";
import { isOpenApiSpec, parseOpenApiSpec, parseCollectionFile } from "./lib/openapi";
import { simulateGrpcCall } from "./lib/grpcMock";
import { invokeGrpcUnary } from "./lib/grpcClient";

interface Ctx {
  workspace: Workspace;
  workspaceDir: string | null;
  openWorkspaceFolder: () => Promise<void>;
  createWorkspace: () => Promise<void>;
  workspaceOpenError: string | null;
  dismissWorkspaceOpenError: () => void;
  pendingWorkspaceSetup: { dir: string; suggestedName: string; folderHasOtherFiles: boolean } | null;
  confirmWorkspaceSetup: (name: string, hidden: boolean) => Promise<void>;
  cancelWorkspaceSetup: () => void;
  renameWorkspace: (name: string) => void;
  responseCacheEnabled: boolean;
  setResponseCacheEnabled: (on: boolean) => void;
  tabs: TabState[];
  activeTabId: string | null;
  addFolder: (parentId: string | null) => string;
  addRequest: (parentId: string | null) => string;
  renameNode: (id: string, name: string) => void;
  deleteNode: (id: string) => void;
  toggleCollapse: (id: string) => void;
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  updateDraft: (id: string, patch: Partial<RequestData>) => void;
  saveTab: (id: string) => void;
  sendTab: (id: string) => Promise<void>;
  setVariables: (rows: ReturnType<typeof newRow>[]) => void;
  pendingCloseId: string | null;
  confirmCloseTab: (action: "save" | "discard" | "cancel") => void;
  addEnvironment: () => string;
  deleteEnvironment: (id: string) => void;
  renameEnvironment: (id: string, name: string) => void;
  setActiveEnvironment: (id: string | null) => void;
  setEnvironmentVariables: (envId: string, rows: KVRow[]) => void;
  importCollection: () => Promise<void>;
  exportCollection: () => Promise<{ skippedGrpcCount: number } | null>;
  moveNodes: (nodeIds: string[], targetId: string, position: "before" | "after" | "inside") => void;
  addGrpcRequest: (parentId: string | null) => string;
  updateGrpcDraft: (id: string, patch: Partial<GrpcRequestData>) => void;
  sendGrpcTab: (id: string) => Promise<void>;
  setProtoLibrary: (files: { name: string; content: string }[]) => void;
}

const WorkspaceContext = createContext<Ctx | null>(null);

function mapTree(nodes: TreeNode[], id: string, fn: (n: TreeNode) => TreeNode | null): TreeNode[] {
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

function insertAt(nodes: TreeNode[], parentId: string | null, node: TreeNode): TreeNode[] {
  if (parentId === null) return [...nodes, node];
  return nodes.map((n) => {
    if (n.kind === "folder" && n.id === parentId) return { ...n, children: [...n.children, node] };
    if (n.kind === "folder") return { ...n, children: insertAt(n.children, parentId, node) };
    return n;
  });
}

function normalizeWorkspace(raw: any, fallbackName = "My Workspace"): Workspace {
  const ws = raw ?? {};
  if (typeof ws.name !== "string" || !ws.name.trim()) ws.name = fallbackName;
  if (!Array.isArray(ws.tree)) ws.tree = [];
  if (!Array.isArray(ws.variables) || !ws.variables.length) ws.variables = [newRow()];
  if (!Array.isArray(ws.environments)) ws.environments = [];
  if (ws.activeEnvironmentId === undefined) ws.activeEnvironmentId = null;
  if (!Array.isArray(ws.protoLibrary)) ws.protoLibrary = [];
  return ws as Workspace;
}

function basenameFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "My Workspace";
}

const RESPONSE_CACHE_SETTING_KEY = "relay-save-responses";

type CachedResponse =
  | { kind: "http"; response: ResponseState }
  | { kind: "grpc"; lastResponse: GrpcResponseSummary };

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>({ name: "My Workspace", tree: [], variables: [newRow()], environments: [], activeEnvironmentId: null, protoLibrary: [] });
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [workspaceHidden, setWorkspaceHidden] = useState(false);
  const [pendingWorkspaceSetup, setPendingWorkspaceSetup] = useState<{ dir: string; suggestedName: string; folderHasOtherFiles: boolean } | null>(null);
  const [workspaceOpenError, setWorkspaceOpenError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [responseCacheEnabled, setResponseCacheEnabledState] = useState(() => localStorage.getItem(RESPONSE_CACHE_SETTING_KEY) !== "false");
  const loaded = useRef(false);
  const grpcCancelRefs = useRef<Map<string, { current: boolean }>>(new Map());
  const responseCacheRef = useRef<Record<string, CachedResponse>>({});

  const setResponseCacheEnabled = useCallback((on: boolean) => {
    localStorage.setItem(RESPONSE_CACHE_SETTING_KEY, String(on));
    setResponseCacheEnabledState(on);
  }, []);

  const persistResponseCache = useCallback((dir: string) => {
    saveResponseCache(dir, JSON.stringify(responseCacheRef.current)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!workspaceDir) {
      responseCacheRef.current = {};
      return;
    }
    loadResponseCache(workspaceDir)
      .then((raw) => { responseCacheRef.current = JSON.parse(raw); })
      .catch(() => { responseCacheRef.current = {}; });
  }, [workspaceDir]);

  useEffect(() => {
    (async () => {
      try {
        const dir = await getLastWorkspaceDir();
        if (dir) {
          const { workspace: raw, hidden } = await loadWorkspaceDir(dir);
          setWorkspace(raw ? normalizeWorkspace(JSON.parse(raw), basenameFromPath(dir)) : demoWorkspace(basenameFromPath(dir)));
          setWorkspaceHidden(hidden);
          setWorkspaceDir(dir);
          return;
        }
        // No .relay folder chosen yet — fall back to the legacy single-file
        // workspace (pre-upgrade data) so it isn't lost; user picks a folder
        // via openWorkspaceFolder to migrate it into the new format.
        const legacyRaw = await loadWorkspaceFile();
        setWorkspace(legacyRaw ? normalizeWorkspace(JSON.parse(legacyRaw)) : demoWorkspace());
      } catch {
        setWorkspace(demoWorkspace());
      } finally {
        loaded.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current || !workspaceDir) return;
    saveWorkspaceDir(workspaceDir, JSON.stringify(workspace), workspaceHidden).catch(() => {});
  }, [workspace, workspaceDir, workspaceHidden]);

  // Strictly for opening a workspace that already exists — kept separate
  // from createWorkspace so the two actions read as distinct in the UI
  // instead of one button silently doing either depending on what's picked.
  const openWorkspaceFolder = useCallback(async () => {
    const dir = await pickWorkspaceFolder();
    if (!dir) return;
    setWorkspaceOpenError(null);
    const { workspace: raw, hidden } = await loadWorkspaceDir(dir);
    if (!raw) {
      setWorkspaceOpenError(`No Relay workspace found in "${basenameFromPath(dir)}". Use "New Workspace" to create one there.`);
      return;
    }
    setWorkspace(normalizeWorkspace(JSON.parse(raw), basenameFromPath(dir)));
    setWorkspaceHidden(hidden);
    await setLastWorkspaceDir(dir);
    setWorkspaceDir(dir);
  }, []);

  const createWorkspace = useCallback(async () => {
    const dir = await pickWorkspaceFolder();
    if (!dir) return;
    setWorkspaceOpenError(null);
    const { workspace: raw } = await loadWorkspaceDir(dir);
    if (raw) {
      setWorkspaceOpenError(`"${basenameFromPath(dir)}" already has a Relay workspace. Use "Open Folder" to open it instead.`);
      return;
    }
    // Empty folder (or one with no Relay workspace yet) — ask for a name
    // (and layout, if relevant) before committing anything to disk.
    const folderHasOtherFiles = await dirHasOtherFiles(dir);
    setPendingWorkspaceSetup({ dir, suggestedName: basenameFromPath(dir), folderHasOtherFiles });
  }, []);

  const dismissWorkspaceOpenError = useCallback(() => setWorkspaceOpenError(null), []);

  const confirmWorkspaceSetup = useCallback(async (name: string, hidden: boolean) => {
    if (!pendingWorkspaceSetup) return;
    const { dir, suggestedName, folderHasOtherFiles } = pendingWorkspaceSetup;
    // A folder that already has other files always gets the isolated
    // .relay/ layout — never let a "visible at root" choice wipe someone's
    // existing project.
    const effectiveHidden = folderHasOtherFiles ? true : hidden;
    // A genuinely new workspace starts blank — it must not inherit whatever
    // was previously loaded (demo data, or another workspace's tree).
    setWorkspace({
      name: name.trim() || suggestedName,
      tree: [],
      variables: [newRow()],
      environments: [],
      activeEnvironmentId: null,
      protoLibrary: [],
    });
    setTabs([]);
    setActiveTabId(null);
    setWorkspaceHidden(effectiveHidden);
    await setLastWorkspaceDir(dir);
    setWorkspaceDir(dir);
    setPendingWorkspaceSetup(null);
  }, [pendingWorkspaceSetup]);

  const cancelWorkspaceSetup = useCallback(() => {
    setPendingWorkspaceSetup(null);
  }, []);

  const renameWorkspace = useCallback((name: string) => {
    setWorkspace((ws) => ({ ...ws, name: name.trim() || ws.name }));
  }, []);

  const addFolder = useCallback((parentId: string | null) => {
    const node: FolderNode = { id: uid(), kind: "folder", name: "New Folder", children: [] };
    setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, node) }));
    return node.id;
  }, []);

  const addRequest = useCallback((parentId: string | null) => {
    const node: RequestNode = { id: uid(), kind: "request", name: "New Request", request: defaultRequest("GET", "") };
    setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, node) }));
    return node.id;
  }, []);

  const addGrpcRequest = useCallback((parentId: string | null) => {
    const node: GrpcRequestNode = { id: uid(), kind: "grpc", name: "New gRPC Request", request: defaultGrpcRequest() };
    setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, node) }));
    return node.id;
  }, []);

  const renameNode = useCallback((id: string, name: string) => {
    setWorkspace((ws) => ({
      ...ws,
      tree: mapTree(ws.tree, id, (n) => ({ ...n, name }) as TreeNode),
    }));
  }, []);

  const deleteNode = useCallback((id: string) => {
    setWorkspace((ws) => ({ ...ws, tree: mapTree(ws.tree, id, () => null) }));
    setTabs((t) => t.filter((tab) => tab.nodeId !== id));
    setActiveTabId((cur) => (cur === id ? null : cur));
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setWorkspace((ws) => ({
      ...ws,
      tree: mapTree(ws.tree, id, (n) => (n.kind === "folder" ? { ...n, collapsed: !n.collapsed } : n)),
    }));
  }, []);

  const openTab = useCallback(
    (id: string) => {
      const node = findNode(workspace.tree, id);
      if (!node || node.kind === "folder") return;
      setTabs((t) => {
        if (t.some((tab) => tab.nodeId === id)) return t;
        const cached = responseCacheEnabled ? responseCacheRef.current[id] : undefined;
        if (node.kind === "grpc") {
          const tab: GrpcTabState = {
            nodeId: id,
            kind: "grpc",
            draft: JSON.parse(JSON.stringify(node.request)),
            dirty: false,
            log: [],
            streaming: false,
            lastResponse: cached?.kind === "grpc" ? cached.lastResponse : null,
          };
          return [...t, tab];
        }
        const tab: HttpTabState = {
          nodeId: id,
          kind: "http",
          draft: normalizeRequestData(JSON.parse(JSON.stringify(node.request))),
          dirty: false,
          response: cached?.kind === "http" ? cached.response : null,
          loading: false,
        };
        return [...t, tab];
      });
      setActiveTabId(id);
    },
    [workspace.tree, responseCacheEnabled]
  );

  const forceCloseTab = useCallback(
    (id: string) => {
      const cancelRef = grpcCancelRefs.current.get(id);
      if (cancelRef) {
        cancelRef.current = true;
        grpcCancelRefs.current.delete(id);
      }
      const idx = tabs.findIndex((x) => x.nodeId === id);
      const next = tabs.filter((x) => x.nodeId !== id);
      setTabs(next);
      if (activeTabId === id) {
        const fallback = next[idx - 1] || next[0];
        setActiveTabId(fallback ? fallback.nodeId : null);
      }
    },
    [tabs, activeTabId]
  );

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((x) => x.nodeId === id);
      if (tab?.dirty) {
        setPendingCloseId(id);
        return;
      }
      forceCloseTab(id);
    },
    [tabs, forceCloseTab]
  );

  const closeOtherTabs = useCallback(
    (id: string) => {
      setTabs(tabs.filter((x) => x.nodeId === id));
      setActiveTabId(id);
    },
    [tabs]
  );

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const updateDraft = useCallback((id: string, patch: Partial<RequestData>) => {
    setTabs((t) => t.map((tab) => (tab.nodeId === id && tab.kind === "http" ? { ...tab, draft: { ...tab.draft, ...patch }, dirty: true } : tab)));
  }, []);

  const updateGrpcDraft = useCallback((id: string, patch: Partial<GrpcRequestData>) => {
    setTabs((t) => t.map((tab) => (tab.nodeId === id && tab.kind === "grpc" ? { ...tab, draft: { ...tab.draft, ...patch }, dirty: true } : tab)));
  }, []);

  const saveTab = useCallback((id: string) => {
    setTabs((t) => {
      const tab = t.find((x) => x.nodeId === id);
      if (!tab) return t;
      setWorkspace((ws) => ({
        ...ws,
        tree: mapTree(ws.tree, id, (n) => {
          if (n.kind === "request" && tab.kind === "http") return { ...n, request: tab.draft };
          if (n.kind === "grpc" && tab.kind === "grpc") return { ...n, request: tab.draft };
          return n;
        }),
      }));
      return t.map((x) => (x.nodeId === id ? { ...x, dirty: false } : x));
    });
  }, []);

  const confirmCloseTab = useCallback(
    (action: "save" | "discard" | "cancel") => {
      if (!pendingCloseId) return;
      if (action === "cancel") {
        setPendingCloseId(null);
        return;
      }
      if (action === "save") saveTab(pendingCloseId);
      const id = pendingCloseId;
      setPendingCloseId(null);
      forceCloseTab(id);
    },
    [pendingCloseId, saveTab, forceCloseTab]
  );

  const setVariables = useCallback((rows: ReturnType<typeof newRow>[]) => {
    setWorkspace((ws) => ({ ...ws, variables: rows.length ? rows : [newRow()] }));
  }, []);

  const setProtoLibrary = useCallback((files: { name: string; content: string }[]) => {
    setWorkspace((ws) => ({ ...ws, protoLibrary: files }));
  }, []);

  const addEnvironment = useCallback(() => {
    const name = "New Environment";
    const env: Environment = { id: uid(), name, variables: [newRow()] };
    setWorkspace((ws) => ({
      ...ws,
      environments: [...ws.environments, env],
      activeEnvironmentId: env.id,
    }));
    return env.id;
  }, []);

  const deleteEnvironment = useCallback((id: string) => {
    setWorkspace((ws) => ({
      ...ws,
      environments: ws.environments.filter((e) => e.id !== id),
      activeEnvironmentId: ws.activeEnvironmentId === id ? null : ws.activeEnvironmentId,
    }));
  }, []);

  const renameEnvironment = useCallback((id: string, name: string) => {
    setWorkspace((ws) => ({
      ...ws,
      environments: ws.environments.map((e) => (e.id === id ? { ...e, name } : e)),
    }));
  }, []);

  const setActiveEnvironment = useCallback((id: string | null) => {
    setWorkspace((ws) => ({ ...ws, activeEnvironmentId: id }));
  }, []);

  const setEnvironmentVariables = useCallback((envId: string, rows: KVRow[]) => {
    setWorkspace((ws) => ({
      ...ws,
      environments: ws.environments.map((e) =>
        e.id === envId ? { ...e, variables: rows.length ? rows : [newRow()] } : e
      ),
    }));
  }, []);

  const moveNodes = useCallback((nodeIds: string[], targetId: string, position: "before" | "after" | "inside") => {
    setWorkspace((ws) => {
      const idSet = new Set(nodeIds.filter((id) => id !== targetId));
      if (idSet.size === 0) return ws;

      // Never drop a folder into its own descendant — checked against every dragged node.
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
          if (idSet.has(n.id)) { removed.push(n); continue; }
          out.push(n.kind === "folder" ? { ...n, children: remove(n.children) } : n);
        }
        return out;
      };
      let tree = remove(ws.tree);
      if (removed.length === 0) return ws;

      if (position === "inside") {
        const insert = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map(n => n.id === targetId && n.kind === "folder"
            ? { ...n, children: [...n.children, ...removed], collapsed: false }
            : n.kind === "folder" ? { ...n, children: insert(n.children) } : n);
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
  }, []);

  const importCollection = useCallback(async () => {
    const path = await pickCollectionFile();
    if (!path) return;
    const raw = await readFileAtPath(path);
    const data = parseCollectionFile(raw);
    if (isPostmanCollection(data)) {
      const { tree } = postmanToTree(data);
      setWorkspace((ws) => ({ ...ws, tree: [...ws.tree, ...tree] }));
    } else if (isRelayWorkspace(data)) {
      setWorkspace((ws) => ({ ...ws, tree: [...ws.tree, ...data.tree] }));
    } else if (isOpenApiSpec(data)) {
      const { tree, variables } = parseOpenApiSpec(data);
      setWorkspace((ws) => {
        const existingKeys = new Set(ws.variables.map((v) => v.key));
        const newVars = variables.filter((v) => !existingKeys.has(v.key));
        return { ...ws, tree: [...ws.tree, ...tree], variables: [...ws.variables, ...newVars] };
      });
    } else {
      throw new Error("Unrecognized format");
    }
  }, []);

  const exportCollection = useCallback(async (): Promise<{ skippedGrpcCount: number } | null> => {
    const name = workspace.name?.trim() || "Relay Collection";
    const fileSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "collection";
    const path = await pickSavePath(`${fileSlug}.relay_collection.json`);
    if (!path) return null;
    const { collection, skippedGrpcCount } = treeToPostman(workspace.tree, name);
    await writeFileAtPath(path, JSON.stringify(collection, null, 2));
    return { skippedGrpcCount };
  }, [workspace.tree, workspace.name]);

  const sendTab = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.nodeId === id);
      if (!tab || tab.kind !== "http") return;
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "http" ? { ...x, loading: true } : x)));
      const activeEnv = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
      const merged = [...workspace.variables];
      if (activeEnv) {
        for (const v of activeEnv.variables) {
          if (!v.key.trim()) continue;
          const idx = merged.findIndex((g) => g.key === v.key);
          if (idx >= 0) merged[idx] = v;
          else merged.push(v);
        }
      }
      const result = await runRequest(tab.draft, merged, setVariables);
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "http" ? { ...x, loading: false, response: result } : x)));
      if (responseCacheEnabled && workspaceDir) {
        responseCacheRef.current[id] = { kind: "http", response: result };
        persistResponseCache(workspaceDir);
      }
    },
    [tabs, workspace.variables, workspace.environments, workspace.activeEnvironmentId, setVariables, responseCacheEnabled, workspaceDir, persistResponseCache]
  );

  const cacheGrpcResponse = useCallback(
    (id: string, lastResponse: GrpcResponseSummary) => {
      if (!responseCacheEnabled || !workspaceDir) return;
      responseCacheRef.current[id] = { kind: "grpc", lastResponse };
      persistResponseCache(workspaceDir);
    },
    [responseCacheEnabled, workspaceDir, persistResponseCache]
  );

  const sendGrpcTab = useCallback(
    async (id: string) => {
      const cancelRef = { current: false };
      grpcCancelRefs.current.set(id, cancelRef);
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, streaming: true, log: [], lastResponse: null } : x)));
      const tab = tabs.find((t) => t.nodeId === id);
      if (!tab || tab.kind !== "grpc") return;

      const canUseImportedProto =
        tab.draft.protoSource === "imported" && !!tab.draft.activeProtoFile;

      if ((tab.draft.protoSource === "reflection" || canUseImportedProto) && tab.draft.methodType === "unary") {
        const sentEntry: GrpcLogEntry = { id: uid(), timestamp: Date.now(), direction: "sent", json: tab.draft.messageJson };
        try {
          const metadata: [string, string][] = tab.draft.metadata
            .filter((m) => m.enabled && m.key.trim())
            .map((m) => [m.key, m.value]);

          const result = await invokeGrpcUnary({
            url: tab.draft.url,
            service: tab.draft.service,
            method: tab.draft.method,
            messageJson: tab.draft.messageJson,
            metadata,
            protoFiles: canUseImportedProto ? workspace.protoLibrary : undefined,
            entryFile: canUseImportedProto ? tab.draft.activeProtoFile : undefined,
          });
          if (cancelRef.current) return;
          const receivedEntry: GrpcLogEntry = { id: uid(), timestamp: Date.now(), direction: "received", json: result.json };
          const lastResponse: GrpcResponseSummary = {
            ok: true,
            durationMs: result.durationMs,
            sizeBytes: new TextEncoder().encode(result.json).length,
            metadata: result.metadata,
            body: result.json,
            error: null,
          };
          setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, log: [sentEntry, receivedEntry], streaming: false, lastResponse } : x)));
          cacheGrpcResponse(id, lastResponse);
        } catch (e: any) {
          if (cancelRef.current) return;
          const errText = String(e);
          const errEntry: GrpcLogEntry = { id: uid(), timestamp: Date.now(), direction: "error", json: errText };
          const lastResponse: GrpcResponseSummary = {
            ok: false,
            durationMs: null,
            sizeBytes: 0,
            metadata: [],
            body: "",
            error: errText,
          };
          setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, log: [sentEntry, errEntry], streaming: false, lastResponse } : x)));
          cacheGrpcResponse(id, lastResponse);
        }
        return;
      }

      await simulateGrpcCall(
        tab.draft,
        (entry) => {
          if (cancelRef.current) return;
          setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, log: [...x.log, entry] } : x)));
        },
        () => cancelRef.current
      );
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, streaming: false } : x)));
    },
    [tabs, workspace.protoLibrary, cacheGrpcResponse]
  );

  const value = useMemo<Ctx>(
    () => ({
      workspace,
      workspaceDir,
      openWorkspaceFolder,
      createWorkspace,
      workspaceOpenError,
      dismissWorkspaceOpenError,
      pendingWorkspaceSetup,
      confirmWorkspaceSetup,
      cancelWorkspaceSetup,
      renameWorkspace,
      responseCacheEnabled,
      setResponseCacheEnabled,
      tabs,
      activeTabId,
      addFolder,
      addRequest,
      addGrpcRequest,
      renameNode,
      deleteNode,
      toggleCollapse,
      openTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      setActiveTab: setActiveTabId,
      updateDraft,
      updateGrpcDraft,
      saveTab,
      sendTab,
      sendGrpcTab,
      setVariables,
      pendingCloseId,
      confirmCloseTab,
      addEnvironment,
      deleteEnvironment,
      renameEnvironment,
      setActiveEnvironment,
      setEnvironmentVariables,
      importCollection,
      exportCollection,
      moveNodes,
      setProtoLibrary,
    }),
    [workspace, workspaceDir, openWorkspaceFolder, createWorkspace, workspaceOpenError, dismissWorkspaceOpenError, pendingWorkspaceSetup, confirmWorkspaceSetup, cancelWorkspaceSetup, renameWorkspace, responseCacheEnabled, setResponseCacheEnabled, tabs, activeTabId, addFolder, addRequest, addGrpcRequest, renameNode, deleteNode, toggleCollapse, openTab, closeTab, closeOtherTabs, closeAllTabs, updateDraft, updateGrpcDraft, saveTab, sendTab, sendGrpcTab, setVariables, pendingCloseId, confirmCloseTab, addEnvironment, deleteEnvironment, renameEnvironment, setActiveEnvironment, setEnvironmentVariables, importCollection, exportCollection, moveNodes, setProtoLibrary]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
