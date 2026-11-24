import CryptoJS from "crypto-js";
import { GrpcRequestData, GrpcResponseSummary } from "../types";
import { buildRelay, substituteVars } from "./pm";
import { runInSandbox } from "./scriptSandbox";
import { toBase64 } from "./base64";

export interface GrpcExecution {
  url: string;
  messageJson: string;
  metadata: [string, string][];
  variables: Record<string, string>;
  initialVariables: Record<string, string>;
  logs: string[];
  preError: string | null;
}

function scriptRequire(name: string) {
  if (name === "crypto-js") return CryptoJS;
  throw new Error(`Module "${name}" is not available. Built-in: crypto-js`);
}

export async function prepareGrpcExecution(draft: GrpcRequestData, url: string, variables: Record<string, string>, safeMode: boolean): Promise<GrpcExecution> {
  const vars = { ...variables };
  const logs: string[] = [];
  const scriptRequest = {
    method: draft.method,
    url,
    headers: draft.metadata.filter((row) => row.enabled && row.key.trim()).map((row) => ({ key: row.key, value: row.value })),
    body: draft.messageJson,
  };
  let preError: string | null = null;
  if (draft.preScript.trim()) {
    try {
      if (safeMode) {
        const result = await runInSandbox({ script: draft.preScript, variables: vars, scriptRequest });
        Object.assign(vars, result.varChanges);
        if (result.scriptRequest) Object.assign(scriptRequest, result.scriptRequest);
        logs.push(...result.logs);
        preError = result.error;
      } else {
        const log = (...args: unknown[]) => logs.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
        const api = buildRelay({ variables: vars, scriptRequest });
        new Function("relay", "pm", "console", "require", draft.preScript)(api, api, { log, info: log, warn: log, error: log }, scriptRequire);
      }
    } catch (error) {
      preError = String(error);
    }
  }
  const metadata: [string, string][] = scriptRequest.headers.map(({ key, value }) => [substituteVars(key, vars) ?? key, substituteVars(value, vars) ?? value]);
  const auth = draft.auth;
  if (auth.type !== "none") {
    let value: string | null = null;
    if (auth.type === "bearer") {
      const token = (substituteVars(auth.bearer?.token ?? "", vars) ?? "").trim();
      value = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    } else if (auth.type === "basic") {
      const username = substituteVars(auth.basic?.username ?? "", vars) ?? "";
      const password = substituteVars(auth.basic?.password ?? "", vars) ?? "";
      value = `Basic ${toBase64(`${username}:${password}`)}`;
    } else if (auth.type === "oauth2" && auth.oauth2?.accessToken) {
      value = `Bearer ${auth.oauth2.accessToken}`;
    }
    if (value !== null) {
      const index = metadata.findIndex(([key]) => key.toLowerCase() === "authorization");
      if (index >= 0) metadata.splice(index, 1);
      metadata.push(["authorization", value]);
    }
  }
  return {
    url: substituteVars(scriptRequest.url, vars) ?? scriptRequest.url,
    messageJson: substituteVars(scriptRequest.body, vars) ?? scriptRequest.body,
    metadata,
    variables: vars,
    initialVariables: variables,
    logs,
    preError,
  };
}

export async function finishGrpcExecution(draft: GrpcRequestData, execution: GrpcExecution, response: GrpcResponseSummary, safeMode: boolean, onVariablesChange: (changes: Record<string, string>) => void): Promise<GrpcResponseSummary> {
  const results: NonNullable<GrpcResponseSummary["testResults"]> = [];
  if (draft.testScript.trim()) {
    const scriptResponse = { status: response.ok ? 200 : null, statusText: response.ok ? "OK" : response.error ?? "", time: response.durationMs ?? 0, headers: response.metadata, body: response.body };
    try {
      if (safeMode) {
        const result = await runInSandbox({ script: draft.testScript, variables: execution.variables, response: scriptResponse });
        results.push(...result.testResults);
        Object.assign(execution.variables, result.varChanges);
        execution.logs.push(...result.logs);
        if (result.error) execution.logs.push(`Post-response script error: ${result.error}`);
      } else {
        const log = (...args: unknown[]) => execution.logs.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
        const api = buildRelay({ variables: execution.variables, response: scriptResponse, testResults: results });
        new Function("relay", "pm", "console", "require", draft.testScript)(api, api, { log, info: log, warn: log, error: log }, scriptRequire);
      }
    } catch (error) {
      execution.logs.push(`Post-response script error: ${String(error)}`);
    }
  }
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(execution.variables)) {
    if (key.trim() && execution.initialVariables[key] !== value) changes[key] = value;
  }
  if (Object.keys(changes).length) onVariablesChange(changes);
  return { ...response, testResults: results, scriptLogs: execution.logs, preError: execution.preError };
}
