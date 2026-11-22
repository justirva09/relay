import { KVRow, Workspace } from "../types";
import { substituteVars } from "./pm";
import { VariableGroup } from "./useVariableMenu";

export function activeVariableRows(workspace: Workspace): KVRow[] {
  const merged = workspace.variables.filter((row) => row.enabled && row.key.trim());
  const activeEnv = workspace.environments.find((env) => env.id === workspace.activeEnvironmentId);
  for (const row of activeEnv?.variables ?? []) {
    if (!row.enabled || !row.key.trim()) continue;
    const index = merged.findIndex((global) => global.key === row.key);
    if (index >= 0) merged[index] = row;
    else merged.push(row);
  }
  return merged;
}

export function activeVariableGroups(workspace: Workspace): VariableGroup[] {
  const groups: VariableGroup[] = [];
  const globals = workspace.variables.filter((row) => row.enabled && row.key.trim()).map((row) => row.key);
  if (globals.length) groups.push({ category: "Global", names: globals });
  const activeEnv = workspace.environments.find((env) => env.id === workspace.activeEnvironmentId);
  if (activeEnv) {
    const names = activeEnv.variables.filter((row) => row.enabled && row.key.trim()).map((row) => row.key);
    if (names.length) groups.push({ category: activeEnv.name, names });
  }
  return groups;
}

export function resolveWorkspaceAddress(address: string, workspace: Workspace): string {
  const values = Object.fromEntries(activeVariableRows(workspace).map((row) => [row.key, row.value]));
  return substituteVars(address, values) ?? address;
}
