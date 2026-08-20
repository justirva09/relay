import { Dispatch, SetStateAction, useCallback } from "react";
import { Environment, KVRow, Workspace, newRow, uid } from "../types";

export function useEnvironments(workspace: Workspace, setWorkspace: Dispatch<SetStateAction<Workspace>>) {
  const setVariables = useCallback(
    (rows: ReturnType<typeof newRow>[]) => {
      setWorkspace((ws) => ({ ...ws, variables: rows.length ? rows : [newRow()] }));
    },
    [setWorkspace]
  );

  const addEnvironment = useCallback(() => {
    const name = "New Environment";
    const env: Environment = { id: uid(), name, variables: [newRow()] };
    setWorkspace((ws) => ({
      ...ws,
      environments: [...ws.environments, env],
      activeEnvironmentId: env.id,
    }));
    return env.id;
  }, [setWorkspace]);

  const deleteEnvironment = useCallback(
    (id: string) => {
      setWorkspace((ws) => ({
        ...ws,
        environments: ws.environments.filter((e) => e.id !== id),
        activeEnvironmentId: ws.activeEnvironmentId === id ? null : ws.activeEnvironmentId,
      }));
    },
    [setWorkspace]
  );

  const renameEnvironment = useCallback(
    (id: string, name: string) => {
      setWorkspace((ws) => ({
        ...ws,
        environments: ws.environments.map((e) => (e.id === id ? { ...e, name } : e)),
      }));
    },
    [setWorkspace]
  );

  const setActiveEnvironment = useCallback(
    (id: string | null) => {
      setWorkspace((ws) => ({ ...ws, activeEnvironmentId: id }));
    },
    [setWorkspace]
  );

  const setEnvironmentVariables = useCallback(
    (envId: string, rows: KVRow[]) => {
      setWorkspace((ws) => ({
        ...ws,
        environments: ws.environments.map((e) => (e.id === envId ? { ...e, variables: rows.length ? rows : [newRow()] } : e)),
      }));
    },
    [setWorkspace]
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

  return {
    setVariables,
    addEnvironment,
    deleteEnvironment,
    renameEnvironment,
    setActiveEnvironment,
    setEnvironmentVariables,
    applyVariableChanges,
  };
}
