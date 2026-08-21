import { Dispatch, SetStateAction, useCallback, useState } from "react";
import { KVRow, TreeNode, Workspace } from "../types";
import { pickCollectionFile, pickSavePath, readFileAtPath, writeFileAtPath } from "../lib/tauri";
import { isPostmanCollection, isRelayWorkspace, postmanToTree, treeToPostman } from "../lib/postman";
import { isOpenApiSpec, parseOpenApiSpec, parseCollectionFile } from "../lib/openapi";
import { mergeIncomingTree, findFolderPath } from "../lib/mergeImport";
import { filterTreeBySelection } from "../lib/treeFilter";

export function useImportExport(workspace: Workspace, setWorkspace: Dispatch<SetStateAction<Workspace>>) {
  const [pendingImport, setPendingImport] = useState<{ tree: TreeNode[]; variables: KVRow[]; targetFolderId?: string } | null>(null);
  const [pendingExport, setPendingExport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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

  // same as above, but new requests land in this folder instead of mirroring
  // the incoming spec's own grouping
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

  // merges only the checked requests, matched by method+URL, so re-importing
  // the same spec updates in place instead of duplicating
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
    [pendingImport, workspace.tree, workspace.variables, setWorkspace]
  );

  const exportCollection = useCallback(() => setPendingExport(true), []);
  const cancelExport = useCallback(() => setPendingExport(false), []);

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

  return {
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
  };
}
