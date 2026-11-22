import { Dispatch, SetStateAction, useCallback, useState } from "react";
import { Environment, KVRow, TreeNode, Workspace, uid } from "../types";
import { listBrunoFilesInDir, pickCollectionFile, pickCollectionFolder, pickSavePath, readFileAtPath, writeFileAtPath } from "../lib/tauri";
import { isPostmanCollection, isPostmanEnvironment, isRelayWorkspace, postmanEnvironmentToRelay, postmanToTree, treeToPostman } from "../lib/postman";
import { isOpenApiSpec, parseOpenApiSpec, parseCollectionFile, treeToOpenApi } from "../lib/openapi";
import { insomniaToTree, isInsomniaExport } from "../lib/insomnia";
import { brunoFilesToTree } from "../lib/bruno";
import { mergeIncomingTree, findFolderPath } from "../lib/mergeImport";
import { filterTreeBySelection } from "../lib/treeFilter";

export interface ImportPayload {
  tree: TreeNode[];
  variables: KVRow[];
  environments: Environment[];
  source: string;
  targetFolderId?: string;
}

export interface ImportStats {
  added: number;
  updated: number;
  variablesAdded: number;
  variableConflicts: number;
  environmentsAdded: number;
  environmentsMerged: number;
}

interface RelayVariablesFile {
  format: "relay-variables";
  version: 1;
  globals: KVRow[];
  environments: Environment[];
}

function freshRows(rows: any[]): KVRow[] {
  return rows.filter((row) => row && typeof row.key === "string" && row.key.trim()).map((row) => ({
    id: uid(), key: row.key, value: String(row.value ?? ""), enabled: row.enabled !== false,
    secret: Boolean(row.secret), description: typeof row.description === "string" ? row.description : "",
  }));
}

function freshEnvironments(environments: any[]): Environment[] {
  return environments.filter((environment) => environment && typeof environment.name === "string").map((environment) => ({
    id: uid(), name: environment.name, variables: freshRows(Array.isArray(environment.variables) ? environment.variables : []),
  }));
}

function nestedOpenApi(data: any): any | null {
  const queue = [data];
  const seen = new Set<any>();
  while (queue.length) {
    const candidate = queue.shift();
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isOpenApiSpec(candidate)) return candidate;
    for (const key of ["data", "spec", "schema", "openapi", "project", "module", "modules"]) {
      const value = candidate[key];
      if (Array.isArray(value)) queue.push(...value);
      else if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function parseImportData(data: any): ImportPayload {
  if (data?.format === "relay-variables" && data?.version === 1) {
    return { tree: [], variables: freshRows(data.globals || []), environments: freshEnvironments(data.environments || []), source: "Relay Variables" };
  }
  if (isPostmanEnvironment(data)) {
    return { tree: [], variables: [], environments: [postmanEnvironmentToRelay(data)], source: "Postman Environment" };
  }
  if (isPostmanCollection(data)) {
    const { tree, variables } = postmanToTree(data);
    return { tree, variables, environments: [], source: "Postman Collection" };
  }
  if (isRelayWorkspace(data)) {
    return {
      tree: data.tree, variables: freshRows(Array.isArray(data.variables) ? data.variables : []),
      environments: freshEnvironments(Array.isArray(data.environments) ? data.environments : []), source: "Relay Workspace",
    };
  }
  if (isOpenApiSpec(data)) {
    const { tree, variables } = parseOpenApiSpec(data);
    return { tree, variables, environments: [], source: "OpenAPI" };
  }
  if (isInsomniaExport(data)) {
    const { tree, variables, environments } = insomniaToTree(data);
    return { tree, variables, environments, source: "Insomnia" };
  }
  const apidogSpec = nestedOpenApi(data);
  if (apidogSpec) {
    const { tree, variables } = parseOpenApiSpec(apidogSpec);
    return { tree, variables, environments: [], source: "Apidog / OpenAPI" };
  }
  throw new Error("Unrecognized collection or variables file.");
}

export function useImportExport(workspace: Workspace, setWorkspace: Dispatch<SetStateAction<Workspace>>) {
  const [pendingImport, setPendingImport] = useState<ImportPayload | null>(null);
  const [pendingExport, setPendingExport] = useState<"choose" | "postman" | "openapi" | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const parseImportSource = useCallback(async (): Promise<ImportPayload | null> => {
    const path = await pickCollectionFile();
    if (!path) return null;
    const raw = await readFileAtPath(path);
    return parseImportData(parseCollectionFile(raw));
  }, []);

  const importCollection = useCallback(async () => {
    try {
      const result = await parseImportSource();
      if (result) setPendingImport(result);
    } catch (e: any) {
      setImportError(e.message || String(e));
    }
  }, [parseImportSource]);

  const importVariables = useCallback(async () => {
    try {
      const result = await parseImportSource();
      if (!result) return;
      if (!result.variables.length && !result.environments.length) {
        throw new Error("No globals or environments were found in that file.");
      }
      setPendingImport({ ...result, tree: [], source: `${result.source} variables` });
    } catch (e: any) {
      setImportError(e.message || String(e));
    }
  }, [parseImportSource]);

  const exportVariables = useCallback(async () => {
    const name = workspace.name?.trim() || "Relay";
    const fileSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "relay";
    const path = await pickSavePath(`${fileSlug}.relay_variables.json`);
    if (!path) return false;
    const safeRows = (rows: KVRow[]) => rows.filter((row) => row.key.trim()).map((row) => ({
      ...row, value: row.secret ? "" : row.value,
    }));
    const payload: RelayVariablesFile = {
      format: "relay-variables",
      version: 1,
      globals: safeRows(workspace.variables),
      environments: workspace.environments.map((environment) => ({ ...environment, variables: safeRows(environment.variables) })),
    };
    await writeFileAtPath(path, JSON.stringify(payload, null, 2));
    return true;
  }, [workspace.name, workspace.variables, workspace.environments]);

  const importBrunoCollection = useCallback(async () => {
    try {
      const dir = await pickCollectionFolder();
      if (!dir) return;
      const files = await listBrunoFilesInDir(dir);
      const { tree, variables, environments } = brunoFilesToTree(files);
      setPendingImport({ tree, variables, environments, source: "Bruno" });
    } catch (e: any) {
      setImportError(e.message || String(e));
    }
  }, []);

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
    (selectedIds: Set<string>): ImportStats => {
      if (!pendingImport) return { added: 0, updated: 0, variablesAdded: 0, variableConflicts: 0, environmentsAdded: 0, environmentsMerged: 0 };
      const selectedTree = filterTreeBySelection(pendingImport.tree, selectedIds);
      const basePath = pendingImport.targetFolderId ? findFolderPath(workspace.tree, pendingImport.targetFolderId) || [] : [];
      const merged = mergeIncomingTree(workspace.tree, selectedTree, basePath);
      const existingKeys = new Set(workspace.variables.map((v) => v.key.toLowerCase()));
      const newVars = pendingImport.variables.filter((v) => !existingKeys.has(v.key.toLowerCase()));
      const variableConflicts = pendingImport.variables.length - newVars.length;
      let environmentsAdded = 0;
      let environmentsMerged = 0;
      const nextEnvironments = workspace.environments.map((environment) => ({ ...environment, variables: [...environment.variables] }));
      for (const incoming of pendingImport.environments) {
        const existing = nextEnvironments.find((environment) => environment.name.toLowerCase() === incoming.name.toLowerCase());
        if (!existing) {
          nextEnvironments.push(incoming);
          environmentsAdded++;
          continue;
        }
        const keys = new Set(existing.variables.map((row) => row.key.toLowerCase()));
        existing.variables.push(...incoming.variables.filter((row) => !keys.has(row.key.toLowerCase())));
        environmentsMerged++;
      }
      setWorkspace((ws) => ({ ...ws, tree: merged.tree, variables: [...ws.variables, ...newVars], environments: nextEnvironments }));
      setPendingImport(null);
      return { added: merged.added, updated: merged.updated, variablesAdded: newVars.length, variableConflicts, environmentsAdded, environmentsMerged };
    },
    [pendingImport, workspace.tree, workspace.variables, setWorkspace]
  );

  const exportCollection = useCallback(() => setPendingExport("choose"), []);
  const chooseExportFormat = useCallback((format: "postman" | "openapi") => setPendingExport(format), []);
  const cancelExport = useCallback(() => setPendingExport(null), []);

  const confirmExport = useCallback(
    async (selectedIds: Set<string>): Promise<{ skippedGrpcCount: number } | null> => {
      const selectedTree = filterTreeBySelection(workspace.tree, selectedIds);
      const name = workspace.name?.trim() || "Relay Collection";
      const fileSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "collection";
      const format = pendingExport === "openapi" ? "openapi" : "postman";
      const path = await pickSavePath(format === "openapi" ? `${fileSlug}.openapi.json` : `${fileSlug}.postman_collection.json`);
      setPendingExport(null);
      if (!path) return null;
      const result = format === "openapi"
        ? (() => { const value = treeToOpenApi(selectedTree, name, workspace.variables); return { payload: value.document, skippedGrpcCount: value.skippedGrpcCount }; })()
        : (() => { const value = treeToPostman(selectedTree, name, workspace.variables); return { payload: value.collection, skippedGrpcCount: value.skippedGrpcCount }; })();
      await writeFileAtPath(path, JSON.stringify(result.payload, null, 2));
      const skippedGrpcCount = result.skippedGrpcCount;
      return { skippedGrpcCount };
    },
    [workspace.tree, workspace.name, workspace.variables, pendingExport]
  );

  return {
    importCollection,
    importVariables,
    exportVariables,
    importBrunoCollection,
    importIntoFolder,
    pendingImport,
    confirmImport,
    cancelImport,
    importError,
    dismissImportError,
    exportCollection,
    chooseExportFormat,
    pendingExport,
    confirmExport,
    cancelExport,
  };
}
