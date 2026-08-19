import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Environment, FolderNode, GrpcLogEntry, GrpcRequestData, GrpcRequestNode, GrpcResponseSummary, GrpcTabState, HttpTabState, KVRow, RequestData, RequestNode, ResponseState, StoredCookie, TabState, TreeNode, Workspace, defaultGrpcRequest, defaultRequest, demoWorkspace, newRow, normalizeRequestData, uid } from "./types";
import { loadWorkspaceFile, pickCollectionFile, pickSavePath, readFileAtPath, writeFileAtPath, pickWorkspaceFolder, getLastWorkspaceDir, setLastWorkspaceDir, loadWorkspaceDir, saveWorkspaceDir, dirHasOtherFiles, loadResponseCache, saveResponseCache, loadCookieJar, saveCookieJar, startMockServer as startMockServerTauri, stopMockServer as stopMockServerTauri, mockServerStatus as mockServerStatusTauri } from "./lib/tauri";
import { runRequest } from "./lib/useSendRequest";
import { isPostmanCollection, isRelayWorkspace, postmanToTree, treeToPostman } from "./lib/postman";
import { isOpenApiSpec, parseOpenApiSpec, parseCollectionFile } from "./lib/openapi";
import { mergeIncomingTree, findFolderPath } from "./lib/mergeImport";
import { filterTreeBySelection } from "./lib/treeFilter";
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
  mockServerPort: number;
  setMockServerPort: (port: number) => void;
  mockServerRunningPort: number | null;
  mockServerError: string | null;
  // Local-only trust decision (see safeModeKey) — when true, pre-request and
  // test scripts run inside scriptSandbox.ts's isolated iframe instead of
  // this page's own JS context, so a script from an imported collection
  // can't reach window.__TAURI_INTERNALS__ (filesystem, git, etc).
  safeMode: boolean;
  setSafeMode: (on: boolean) => void;
  // Local-only cookie jar (see lib/cookies.ts) — never part of the .relay
  // files, same as Postman/Bruno keep cookies out of shared collections.
  cookies: StoredCookie[];
  setCookies: (cookies: StoredCookie[]) => void;
  toggleMockServer: () => Promise<void>;
  tabs: TabState[];
  activeTabId: string | null;
  // Bumped on every openTab() call, including re-clicking the tab that's
  // already active — activeTabId alone won't change in that case, but UI
  // that wants to react to "a request was picked" (e.g. dismissing an
  // overview screen) needs a signal that fires regardless.
  openTick: number;
  addFolder: (parentId: string | null) => string;
  addRequest: (parentId: string | null, preset?: { name: string; request: RequestData }) => string;
  renameNode: (id: string, name: string) => void;
  deleteNode: (id: string) => void;
  deleteNodes: (ids: string[]) => void;
  toggleCollapse: (id: string) => void;
  collapseAllFolders: () => void;
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
  importIntoFolder: (folderId: string) => Promise<void>;
  pendingImport: { tree: TreeNode[]; variables: KVRow[]; targetFolderId?: string } | null;
  confirmImport: (selectedIds: Set<string>) => { added: number; updated: number };
  cancelImport: () => void;
  importError: string | null;
  dismissImportError: () => void;
  exportCollection: () => void;
  pendingExport: boolean;
  confirmExport: (selectedIds: Set<string>) => Promise<{ skippedGrpcCount: number } | null>;
  cancelExport: () => void;
  compareOpen: boolean;
  openCompare: () => void;
  closeCompare: () => void;
  // Set to force the Environments modal open on a specific tab ("globals"
  // or an environment id), optionally scrolling to and flashing one
  // variable row — used by the {{variable}} click-to-navigate feature,
  // which lives in RequestPanel/KeyValueEditor, far from EnvironmentBar
  // (which otherwise owns the modal's open state entirely locally).
  envModalTarget: { tab: string; key?: string } | null;
  openEnvironmentModal: (tab: string, key?: string) => void;
  closeEnvironmentModal: () => void;
  // Lifted out of Sidebar (which owns the "From cURL" entry points in the
  // tree) so the first-run Welcome modal — rendered from App.tsx, nowhere
  // near Sidebar — can trigger the same import flow.
  curlImportOpen: boolean;
  curlImportParentId: string | null;
  openCurlImport: (parentId: string | null) => void;
  closeCurlImport: () => void;
  pauseAutosave: () => void;
  resumeAutosave: () => void;
  moveNodes: (nodeIds: string[], targetId: string, position: "before" | "after" | "inside") => void;
  addGrpcRequest: (parentId: string | null) => string;
  duplicateNode: (id: string) => string | null;
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

function cloneWithFreshIds(node: TreeNode): TreeNode {
  if (node.kind === "folder") {
    return { ...node, id: uid(), children: node.children.map(cloneWithFreshIds) };
  }
  return { ...node, id: uid() };
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
const MOCK_SERVER_PORT_KEY = "relay-mock-server-port";
const SAFE_MODE_KEY_PREFIX = "relay-safe-mode:";

// Deliberately keyed by workspace dir and stored ONLY in localStorage — never
// inside the workspace's own committed files. This is a local trust decision
// about scripts from a collection someone else authored; if it were stored
// in the workspace itself, the collection's author could just ship
// safeMode: false in the file and silently disable the protection for
// everyone who opens it. Defaults to Safe Mode ON for every workspace,
// including one with no dir yet (the in-memory/demo case).
function safeModeKey(dir: string | null): string {
  return SAFE_MODE_KEY_PREFIX + (dir || "__no_dir__");
}

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
  const [openTick, setOpenTick] = useState(0);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ tree: TreeNode[]; variables: KVRow[]; targetFolderId?: string } | null>(null);
  const [pendingExport, setPendingExport] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [envModalTarget, setEnvModalTarget] = useState<{ tab: string; key?: string } | null>(null);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [curlImportParentId, setCurlImportParentId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [responseCacheEnabled, setResponseCacheEnabledState] = useState(() => localStorage.getItem(RESPONSE_CACHE_SETTING_KEY) !== "false");
  const [mockServerPort, setMockServerPort] = useState<number>(() => Number(localStorage.getItem(MOCK_SERVER_PORT_KEY)) || 4010);
  const [mockServerRunningPort, setMockServerRunningPort] = useState<number | null>(null);
  const [mockServerError, setMockServerError] = useState<string | null>(null);
  const [safeMode, setSafeModeState] = useState<boolean>(() => localStorage.getItem(safeModeKey(null)) !== "false");
  const [cookies, setCookies] = useState<StoredCookie[]>([]);
  const loaded = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveArgsRef = useRef<{ dir: string; data: string; hidden: boolean } | null>(null);
  const autosavePausedRef = useRef(false);
  const grpcCancelRefs = useRef<Map<string, { current: boolean }>>(new Map());
  const responseCacheRef = useRef<Record<string, CachedResponse>>({});

  const setResponseCacheEnabled = useCallback((on: boolean) => {
    localStorage.setItem(RESPONSE_CACHE_SETTING_KEY, String(on));
    setResponseCacheEnabledState(on);
  }, []);

  // Reloads this specific workspace's own Safe Mode preference whenever the
  // open workspace changes — each workspace dir gets an independent local
  // trust decision, not a single global toggle that'd otherwise leak
  // whatever was last set into a workspace opened later.
  useEffect(() => {
    setSafeModeState(localStorage.getItem(safeModeKey(workspaceDir)) !== "false");
  }, [workspaceDir]);

  // Local-only cookie jar (see lib/cookies.ts) — loaded per workspace dir,
  // never part of the .relay files themselves.
  useEffect(() => {
    if (!workspaceDir) {
      setCookies([]);
      return;
    }
    loadCookieJar(workspaceDir)
      .then((raw) => setCookies(JSON.parse(raw)))
      .catch(() => setCookies([]));
  }, [workspaceDir]);

  useEffect(() => {
    if (!workspaceDir) return;
    saveCookieJar(workspaceDir, JSON.stringify(cookies)).catch(() => {});
  }, [cookies, workspaceDir]);

  const setSafeMode = useCallback(
    (on: boolean) => {
      localStorage.setItem(safeModeKey(workspaceDir), String(on));
      setSafeModeState(on);
    },
    [workspaceDir]
  );

  const setMockServerPortPersisted = useCallback((port: number) => {
    localStorage.setItem(MOCK_SERVER_PORT_KEY, String(port));
    setMockServerPort(port);
  }, []);

  const toggleMockServer = useCallback(async () => {
    setMockServerError(null);
    try {
      if (mockServerRunningPort) {
        await stopMockServerTauri();
        setMockServerRunningPort(null);
        return;
      }
      if (!workspaceDir) {
        setMockServerError("Save this workspace to a folder first.");
        return;
      }
      await startMockServerTauri(workspaceDir, mockServerPort);
      setMockServerRunningPort(mockServerPort);
    } catch (e: any) {
      setMockServerError(e?.message || String(e));
    }
  }, [mockServerRunningPort, mockServerPort, workspaceDir]);

  useEffect(() => {
    mockServerStatusTauri().then(setMockServerRunningPort).catch(() => {});
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

  // save_workspace_dir rewrites the entire .relay directory from scratch
  // (deletes every file, re-serializes every request/folder/environment) —
  // debounced so rapid typing coalesces into one write instead of a full
  // directory rewrite per keystroke.
  useEffect(() => {
    if (!loaded.current || !workspaceDir) return;
    pendingSaveArgsRef.current = { dir: workspaceDir, data: JSON.stringify(workspace), hidden: workspaceHidden };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      // Skip while paused (see pauseAutosave) — a stage/commit flow writes
      // specific files directly to disk outside React state; if this timer
      // fires mid-sequence, its full-tree rewrite (from the in-memory draft)
      // would silently clobber a carefully-merged partial-field file before
      // `git add` ever reads it, dragging unselected field changes into the
      // commit. pendingSaveArgsRef keeps the latest args for resumeAutosave
      // to flush once it's safe.
      if (autosavePausedRef.current) return;
      const args = pendingSaveArgsRef.current;
      if (args) saveWorkspaceDir(args.dir, args.data, args.hidden).catch(() => {});
    }, 500);
  }, [workspace, workspaceDir, workspaceHidden]);

  // Flush a still-pending debounced save immediately on unmount (e.g. app
  // quitting right after typing) so the last edits aren't dropped.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const args = pendingSaveArgsRef.current;
        if (args) saveWorkspaceDir(args.dir, args.data, args.hidden).catch(() => {});
      }
    };
  }, []);

  const pauseAutosave = useCallback(() => {
    autosavePausedRef.current = true;
  }, []);

  // Flushes the latest in-memory draft to disk (harmless/idempotent — by
  // this point any direct file writes from a paused operation are done, so
  // this just re-syncs everything to what React already believes is true)
  // before letting the debounced autosave resume normal operation.
  const resumeAutosave = useCallback(() => {
    autosavePausedRef.current = false;
    const args = pendingSaveArgsRef.current;
    if (args) saveWorkspaceDir(args.dir, args.data, args.hidden).catch(() => {});
  }, []);

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

  const addRequest = useCallback((parentId: string | null, preset?: { name: string; request: RequestData }) => {
    const node: RequestNode = {
      id: uid(),
      kind: "request",
      name: preset?.name || "New Request",
      request: preset?.request ?? defaultRequest("GET", ""),
    };
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

  const duplicateNode = useCallback(
    (id: string): string | null => {
      const original = findNode(workspace.tree, id);
      if (!original) return null;
      const parentId = findParentFolderId(workspace.tree, id);
      const clone = { ...cloneWithFreshIds(original), name: `${original.name} copy` };
      setWorkspace((ws) => ({ ...ws, tree: insertAt(ws.tree, parentId, clone) }));
      return clone.id;
    },
    [workspace.tree]
  );

  const deleteNode = useCallback((id: string) => {
    setWorkspace((ws) => ({ ...ws, tree: mapTree(ws.tree, id, () => null) }));
    setTabs((t) => t.filter((tab) => tab.nodeId !== id));
    setActiveTabId((cur) => (cur === id ? null : cur));
  }, []);

  const deleteNodes = useCallback((ids: string[]) => {
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
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setWorkspace((ws) => ({
      ...ws,
      tree: mapTree(ws.tree, id, (n) => (n.kind === "folder" ? { ...n, collapsed: !n.collapsed } : n)),
    }));
  }, []);

  const collapseAllFolders = useCallback(() => {
    const collapseAll = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => (n.kind === "folder" ? { ...n, collapsed: true, children: collapseAll(n.children) } : n));
    setWorkspace((ws) => ({ ...ws, tree: collapseAll(ws.tree) }));
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
      setOpenTick((t) => t + 1);
    },
    [workspace.tree, responseCacheEnabled]
  );

  // Switching to a tab that's already open (clicked directly in the tab bar,
  // not via the sidebar) doesn't go through openTab — still needs to bump
  // openTick so UI reacting to "a request was picked" (e.g. dismissing the
  // overview screen) fires even when activeTabId ends up unchanged.
  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
    setOpenTick((t) => t + 1);
  }, []);

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

  const parseImportSource = useCallback(async (): Promise<{ tree: TreeNode[]; variables: KVRow[] } | null> => {
    const path = await pickCollectionFile();
    if (!path) return null;
    const raw = await readFileAtPath(path);
    const data = parseCollectionFile(raw);
    if (isPostmanCollection(data)) {
      const { tree } = postmanToTree(data);
      return { tree, variables: [] };
    } else if (isRelayWorkspace(data)) {
      return { tree: data.tree, variables: [] };
    } else if (isOpenApiSpec(data)) {
      const { tree, variables } = parseOpenApiSpec(data);
      return { tree, variables };
    }
    throw new Error("Unrecognized format");
  }, []);

  const importCollection = useCallback(async () => {
    try {
      const result = await parseImportSource();
      if (result) setPendingImport(result);
    } catch (e: any) {
      setImportError(e.message || String(e));
    }
  }, [parseImportSource]);

  // Same file picker + parse, but new (unmatched) requests land inside this
  // specific folder instead of mirroring the incoming spec's own grouping.
  const importIntoFolder = useCallback(
    async (folderId: string) => {
      try {
        const result = await parseImportSource();
        if (result) setPendingImport({ ...result, targetFolderId: folderId });
      } catch (e: any) {
        setImportError(e.message || String(e));
      }
    },
    [parseImportSource]
  );

  const cancelImport = useCallback(() => setPendingImport(null), []);
  const dismissImportError = useCallback(() => setImportError(null), []);

  // Merges only the requests the user checked in the picker into the
  // existing workspace tree (matched by method+URL, see mergeImport.ts) —
  // re-importing the same spec updates in place instead of duplicating.
  const confirmImport = useCallback(
    (selectedIds: Set<string>): { added: number; updated: number } => {
      if (!pendingImport) return { added: 0, updated: 0 };
      const selectedTree = filterTreeBySelection(pendingImport.tree, selectedIds);
      const basePath = pendingImport.targetFolderId ? findFolderPath(workspace.tree, pendingImport.targetFolderId) || [] : [];
      const merged = mergeIncomingTree(workspace.tree, selectedTree, basePath);
      const existingKeys = new Set(workspace.variables.map((v) => v.key));
      const newVars = pendingImport.variables.filter((v) => !existingKeys.has(v.key));
      setWorkspace((ws) => ({ ...ws, tree: merged.tree, variables: [...ws.variables, ...newVars] }));
      setPendingImport(null);
      return { added: merged.added, updated: merged.updated };
    },
    [pendingImport, workspace.tree, workspace.variables]
  );

  const exportCollection = useCallback(() => setPendingExport(true), []);

  const cancelExport = useCallback(() => setPendingExport(false), []);

  const openCompare = useCallback(() => setCompareOpen(true), []);
  const closeCompare = useCallback(() => setCompareOpen(false), []);
  const openEnvironmentModal = useCallback((tab: string, key?: string) => setEnvModalTarget({ tab, key }), []);
  const closeEnvironmentModal = useCallback(() => setEnvModalTarget(null), []);
  const openCurlImport = useCallback((parentId: string | null) => {
    setCurlImportParentId(parentId);
    setCurlImportOpen(true);
  }, []);
  const closeCurlImport = useCallback(() => setCurlImportOpen(false), []);

  const confirmExport = useCallback(
    async (selectedIds: Set<string>): Promise<{ skippedGrpcCount: number } | null> => {
      const selectedTree = filterTreeBySelection(workspace.tree, selectedIds);
      const name = workspace.name?.trim() || "Relay Collection";
      const fileSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "collection";
      const path = await pickSavePath(`${fileSlug}.relay_collection.json`);
      setPendingExport(false);
      if (!path) return null;
      const { collection, skippedGrpcCount } = treeToPostman(selectedTree, name);
      await writeFileAtPath(path, JSON.stringify(collection, null, 2));
      return { skippedGrpcCount };
    },
    [workspace.tree, workspace.name]
  );

  // A pre-request/test script's pm.variables.set(...) needs to persist, but
  // must land back in whichever scope the variable actually came from — not
  // get flattened into Globals just because it was merged in for send-time
  // substitution (see systematic-debugging session note: this used to
  // silently copy the whole active-environment pool into Globals on every
  // single send).
  const applyVariableChanges = useCallback(
    (changed: Record<string, string>) => {
      if (!Object.keys(changed).length) return;
      const activeEnv = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
      const envKeys = new Set((activeEnv?.variables ?? []).map((v) => v.key));
      const globalChanges: Record<string, string> = {};
      const envChanges: Record<string, string> = {};
      for (const [k, v] of Object.entries(changed)) {
        if (envKeys.has(k)) envChanges[k] = v;
        else globalChanges[k] = v;
      }
      if (Object.keys(globalChanges).length) {
        const existingKeys = new Set(workspace.variables.map((r) => r.key));
        const updated = workspace.variables.map((r) => (globalChanges[r.key] !== undefined ? { ...r, value: globalChanges[r.key] } : r));
        const additions = Object.entries(globalChanges)
          .filter(([k]) => !existingKeys.has(k))
          .map(([k, v]) => ({ id: uid(), key: k, value: v, enabled: true }));
        setVariables([...updated, ...additions]);
      }
      if (activeEnv && Object.keys(envChanges).length) {
        const updated = activeEnv.variables.map((r) => (envChanges[r.key] !== undefined ? { ...r, value: envChanges[r.key] } : r));
        setEnvironmentVariables(activeEnv.id, updated);
      }
    },
    [workspace.variables, workspace.environments, workspace.activeEnvironmentId, setVariables, setEnvironmentVariables]
  );

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
      const result = await runRequest(tab.draft, merged, applyVariableChanges, { safeMode, cookies, onCookiesChange: setCookies });
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "http" ? { ...x, loading: false, response: result } : x)));
      if (responseCacheEnabled && workspaceDir) {
        responseCacheRef.current[id] = { kind: "http", response: result };
        persistResponseCache(workspaceDir);
      }
    },
    [tabs, workspace.variables, workspace.environments, workspace.activeEnvironmentId, applyVariableChanges, responseCacheEnabled, workspaceDir, persistResponseCache, safeMode, cookies]
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
      mockServerPort,
      setMockServerPort: setMockServerPortPersisted,
      mockServerRunningPort,
      mockServerError,
      toggleMockServer,
      safeMode,
      setSafeMode,
      cookies,
      setCookies,
      tabs,
      activeTabId,
      openTick,
      addFolder,
      addRequest,
      addGrpcRequest,
      duplicateNode,
      renameNode,
      deleteNode,
      deleteNodes,
      toggleCollapse,
      collapseAllFolders,
      openTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      setActiveTab,
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
      importIntoFolder,
      pendingImport,
      confirmImport,
      cancelImport,
      importError,
      dismissImportError,
      exportCollection,
      pendingExport,
      confirmExport,
      cancelExport,
      compareOpen,
      openCompare,
      closeCompare,
      envModalTarget,
      openEnvironmentModal,
      closeEnvironmentModal,
      curlImportOpen,
      curlImportParentId,
      openCurlImport,
      closeCurlImport,
      pauseAutosave,
      resumeAutosave,
      moveNodes,
      setProtoLibrary,
    }),
    [workspace, workspaceDir, openWorkspaceFolder, createWorkspace, workspaceOpenError, dismissWorkspaceOpenError, pendingWorkspaceSetup, confirmWorkspaceSetup, cancelWorkspaceSetup, renameWorkspace, responseCacheEnabled, setResponseCacheEnabled, mockServerPort, setMockServerPortPersisted, mockServerRunningPort, mockServerError, toggleMockServer, safeMode, setSafeMode, cookies, setCookies, tabs, activeTabId, openTick, addFolder, addRequest, addGrpcRequest, duplicateNode, renameNode, deleteNode, deleteNodes, toggleCollapse, collapseAllFolders, openTab, setActiveTab, closeTab, closeOtherTabs, closeAllTabs, updateDraft, updateGrpcDraft, saveTab, sendTab, sendGrpcTab, setVariables, pendingCloseId, confirmCloseTab, addEnvironment, deleteEnvironment, renameEnvironment, setActiveEnvironment, setEnvironmentVariables, importCollection, importIntoFolder, pendingImport, confirmImport, cancelImport, importError, dismissImportError, exportCollection, pendingExport, confirmExport, cancelExport, compareOpen, openCompare, closeCompare, envModalTarget, openEnvironmentModal, closeEnvironmentModal, curlImportOpen, curlImportParentId, openCurlImport, closeCurlImport, pauseAutosave, resumeAutosave, moveNodes, setProtoLibrary]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
