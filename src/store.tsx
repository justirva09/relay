import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { GrpcLogEntry, GrpcRequestData, GrpcResponseSummary, GrpcTabState, HttpTabState, KVRow, RequestData, StoredCookie, TabState, TreeNode, Workspace, demoWorkspace, newRow, normalizeGrpcRequestData, normalizeRequestData, uid } from "./types";
import { loadWorkspaceFile, pickWorkspaceFolder, getLastWorkspaceDir, setLastWorkspaceDir, loadWorkspaceDir, saveWorkspaceDir, dirHasOtherFiles } from "./lib/tauri";
import { runRequest } from "./lib/useSendRequest";
import { simulateGrpcCall } from "./lib/grpcMock";
import { cancelGrpcServerStream, invokeGrpcServerStream, invokeGrpcUnary } from "./lib/grpcClient";
import { findNode, mapTree } from "./store/treeOps";
import { useCookieJar } from "./store/useCookieJar";
import { useMockServer } from "./store/useMockServer";
import { useSafeMode } from "./store/useSafeMode";
import { useResponseCache } from "./store/useResponseCache";
import { useEnvironments } from "./store/useEnvironments";
import { useTreeActions } from "./store/useTreeActions";
import { useImportExport } from "./store/useImportExport";

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
  // Writes a pre/test script's pm.variables.set()/pm.environment.set()
  // changes back to the right scope (workspace-global vs active
  // environment) — exposed so the Runner can send requests exactly the way
  // a single request's own Send button does.
  applyVariableChanges: (changed: Record<string, string>) => void;
  runnerOpen: boolean;
  openRunner: () => void;
  closeRunner: () => void;
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
  cancelGrpcTab: (id: string) => Promise<void>;
  setProtoLibrary: (files: { name: string; content: string }[]) => void;
}

const WorkspaceContext = createContext<Ctx | null>(null);

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
  const [compareOpen, setCompareOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [envModalTarget, setEnvModalTarget] = useState<{ tab: string; key?: string } | null>(null);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [curlImportParentId, setCurlImportParentId] = useState<string | null>(null);
  const loaded = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveArgsRef = useRef<{ dir: string; data: string; hidden: boolean } | null>(null);
  const autosavePausedRef = useRef(false);
  const grpcCancelRefs = useRef<Map<string, { current: boolean; requestId?: string }>>(new Map());

  const { cookies, setCookies } = useCookieJar(workspaceDir);
  const { mockServerPort, setMockServerPort, mockServerRunningPort, mockServerError, toggleMockServer } = useMockServer(workspaceDir);
  const { safeMode, setSafeMode } = useSafeMode(workspaceDir);
  const { responseCacheEnabled, setResponseCacheEnabled, responseCacheRef, persistResponseCache } = useResponseCache(workspaceDir);
  const { setVariables, addEnvironment, deleteEnvironment, renameEnvironment, setActiveEnvironment, setEnvironmentVariables, applyVariableChanges } =
    useEnvironments(workspace, setWorkspace);
  const { addFolder, addRequest, addGrpcRequest, renameNode, duplicateNode, deleteNode, deleteNodes, toggleCollapse, collapseAllFolders, moveNodes, setProtoLibrary } =
    useTreeActions(workspace, setWorkspace, setTabs, setActiveTabId);
  const {
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
  } = useImportExport(workspace, setWorkspace);

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
            draft: normalizeGrpcRequestData(JSON.parse(JSON.stringify(node.request))),
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
    [workspace.tree, responseCacheEnabled, responseCacheRef]
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
        if (cancelRef.requestId) cancelGrpcServerStream(cancelRef.requestId).catch(() => {});
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

  const openCompare = useCallback(() => setCompareOpen(true), []);
  const openRunner = useCallback(() => setRunnerOpen(true), []);
  const closeRunner = useCallback(() => setRunnerOpen(false), []);
  const closeCompare = useCallback(() => setCompareOpen(false), []);
  const openEnvironmentModal = useCallback((tab: string, key?: string) => setEnvModalTarget({ tab, key }), []);
  const closeEnvironmentModal = useCallback(() => setEnvModalTarget(null), []);
  const openCurlImport = useCallback((parentId: string | null) => {
    setCurlImportParentId(parentId);
    setCurlImportOpen(true);
  }, []);
  const closeCurlImport = useCallback(() => setCurlImportOpen(false), []);

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
    [tabs, workspace.variables, workspace.environments, workspace.activeEnvironmentId, applyVariableChanges, responseCacheEnabled, workspaceDir, persistResponseCache, safeMode, cookies, setCookies, responseCacheRef]
  );

  const cacheGrpcResponse = useCallback(
    (id: string, lastResponse: GrpcResponseSummary) => {
      if (!responseCacheEnabled || !workspaceDir) return;
      responseCacheRef.current[id] = { kind: "grpc", lastResponse };
      persistResponseCache(workspaceDir);
    },
    [responseCacheEnabled, workspaceDir, persistResponseCache, responseCacheRef]
  );

  const sendGrpcTab = useCallback(
    async (id: string) => {
      const tab = tabs.find((item) => item.nodeId === id);
      if (!tab || tab.kind !== "grpc") return;
      const cancelRef: { current: boolean; requestId?: string } = { current: false };
      grpcCancelRefs.current.set(id, cancelRef);
      setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, streaming: true, log: [], lastResponse: null } : x)));

      const canUseImportedProto =
        tab.draft.protoSource === "imported" && !!tab.draft.activeProtoFile;

      if ((tab.draft.protoSource === "reflection" || canUseImportedProto) && tab.draft.methodType === "server-stream") {
        const sentEntry: GrpcLogEntry = { id: uid(), timestamp: Date.now(), direction: "sent", json: tab.draft.messageJson };
        setTabs((current) =>
          current.map((item) => (item.nodeId === id && item.kind === "grpc" ? { ...item, log: [sentEntry] } : item))
        );
        const requestId = uid();
        cancelRef.requestId = requestId;
        const receivedMessages: string[] = [];
        let initialMetadata: [string, string][] = [];
        try {
          const metadata: [string, string][] = tab.draft.metadata
            .filter((item) => item.enabled && item.key.trim())
            .map((item) => [item.key, item.value]);
          const result = await invokeGrpcServerStream(
            requestId,
            {
              url: tab.draft.url,
              service: tab.draft.service,
              method: tab.draft.method,
              messageJson: tab.draft.messageJson,
              metadata,
              timeoutMs: tab.draft.settings.timeoutMs,
              waitForReady: tab.draft.settings.waitForReady,
              compression: tab.draft.settings.compression,
              maxResponseSizeBytes: Math.round(tab.draft.settings.maxResponseSizeMb * 1024 * 1024),
              protoFiles: canUseImportedProto ? workspace.protoLibrary : undefined,
              entryFile: canUseImportedProto ? tab.draft.activeProtoFile : undefined,
            },
            (json) => {
              receivedMessages.push(json);
              if (cancelRef.current) return;
              const entry: GrpcLogEntry = { id: uid(), timestamp: Date.now(), direction: "received", json };
              setTabs((current) =>
                current.map((item) =>
                  item.nodeId === id && item.kind === "grpc" ? { ...item, log: [...item.log, entry] } : item
                )
              );
            },
            (metadata) => {
              initialMetadata = metadata;
            }
          );
          const body = result.cancelled
            ? JSON.stringify(receivedMessages.map((json) => JSON.parse(json)), null, 2)
            : result.json;
          const lastResponse: GrpcResponseSummary = {
            ok: !result.cancelled,
            durationMs: result.durationMs,
            sizeBytes: result.cancelled ? new TextEncoder().encode(body).length : result.sizeBytes,
            metadata: result.cancelled ? initialMetadata : result.metadata,
            body,
            error: null,
            compression: tab.draft.settings.compression === "gzip" ? "gzip" : undefined,
            cancelled: result.cancelled,
            messageCount: result.cancelled ? receivedMessages.length : result.messageCount,
          };
          setTabs((current) =>
            current.map((item) =>
              item.nodeId === id && item.kind === "grpc" ? { ...item, streaming: false, lastResponse } : item
            )
          );
          cacheGrpcResponse(id, lastResponse);
        } catch (error) {
          const errorText = String(error);
          const errorEntry: GrpcLogEntry = { id: uid(), timestamp: Date.now(), direction: "error", json: errorText };
          const lastResponse: GrpcResponseSummary = {
            ok: false,
            durationMs: null,
            sizeBytes: 0,
            metadata: [],
            body: "",
            error: errorText,
            compression: tab.draft.settings.compression === "gzip" ? "gzip" : undefined,
          };
          setTabs((current) =>
            current.map((item) =>
              item.nodeId === id && item.kind === "grpc"
                ? { ...item, log: [...item.log, errorEntry], streaming: false, lastResponse }
                : item
            )
          );
          cacheGrpcResponse(id, lastResponse);
        } finally {
          grpcCancelRefs.current.delete(id);
        }
        return;
      }

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
            timeoutMs: tab.draft.settings.timeoutMs,
            waitForReady: tab.draft.settings.waitForReady,
            compression: tab.draft.settings.compression,
            maxResponseSizeBytes: Math.round(tab.draft.settings.maxResponseSizeMb * 1024 * 1024),
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
            compression: tab.draft.settings.compression === "gzip" ? "gzip" : undefined,
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
            compression: tab.draft.settings.compression === "gzip" ? "gzip" : undefined,
          };
          setTabs((t) => t.map((x) => (x.nodeId === id && x.kind === "grpc" ? { ...x, log: [sentEntry, errEntry], streaming: false, lastResponse } : x)));
          cacheGrpcResponse(id, lastResponse);
        } finally {
          grpcCancelRefs.current.delete(id);
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
      grpcCancelRefs.current.delete(id);
    },
    [tabs, workspace.protoLibrary, cacheGrpcResponse]
  );

  const cancelGrpcTab = useCallback(async (id: string) => {
    const cancelRef = grpcCancelRefs.current.get(id);
    if (!cancelRef) return;
    cancelRef.current = true;
    if (cancelRef.requestId) {
      try {
        await cancelGrpcServerStream(cancelRef.requestId);
      } catch {
        // The stream may have completed between clicking Stop and dispatching cancellation.
      }
    }
  }, []);

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
      setMockServerPort,
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
      cancelGrpcTab,
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
      applyVariableChanges,
      runnerOpen,
      openRunner,
      closeRunner,
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
    [workspace, workspaceDir, openWorkspaceFolder, createWorkspace, workspaceOpenError, dismissWorkspaceOpenError, pendingWorkspaceSetup, confirmWorkspaceSetup, cancelWorkspaceSetup, renameWorkspace, responseCacheEnabled, setResponseCacheEnabled, mockServerPort, setMockServerPort, mockServerRunningPort, mockServerError, toggleMockServer, safeMode, setSafeMode, cookies, setCookies, tabs, activeTabId, openTick, addFolder, addRequest, addGrpcRequest, duplicateNode, renameNode, deleteNode, deleteNodes, toggleCollapse, collapseAllFolders, openTab, setActiveTab, closeTab, closeOtherTabs, closeAllTabs, updateDraft, updateGrpcDraft, saveTab, sendTab, sendGrpcTab, cancelGrpcTab, setVariables, pendingCloseId, confirmCloseTab, addEnvironment, deleteEnvironment, renameEnvironment, setActiveEnvironment, setEnvironmentVariables, importCollection, importIntoFolder, pendingImport, confirmImport, cancelImport, importError, dismissImportError, exportCollection, pendingExport, confirmExport, cancelExport, compareOpen, openCompare, closeCompare, applyVariableChanges, runnerOpen, openRunner, closeRunner, envModalTarget, openEnvironmentModal, closeEnvironmentModal, curlImportOpen, curlImportParentId, openCurlImport, closeCurlImport, pauseAutosave, resumeAutosave, moveNodes, setProtoLibrary]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
