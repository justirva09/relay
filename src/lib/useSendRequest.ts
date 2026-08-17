import CryptoJS from "crypto-js";
import { buildPm, substituteVars, substitutePathParams, TestResultDraft } from "./pm";
import { sendHttpRequest } from "./tauri";
import { KVRow, RequestData, ResponseState, encodeUrlencodedRows } from "../types";

export async function runRequest(
  req: RequestData,
  variables: KVRow[],
  onVariablesChange: (rows: KVRow[]) => void
): Promise<ResponseState> {
  const logs: string[] = [];
  const logFn = (...a: any[]) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  const consoleWrap = { log: logFn, info: logFn, warn: logFn, error: logFn };

  const varsObj: Record<string, string> = {};
  variables.forEach((r) => {
    if (r.key.trim()) varsObj[r.key] = r.value;
  });

  const scriptRequest = {
    method: req.method,
    url: req.url,
    headers: req.headers.filter((h) => h.enabled && h.key.trim()).map((h) => ({ key: h.key, value: h.value })),
    body: req.bodyMode !== "none" && req.bodyMode !== "form-data" && req.bodyMode !== "urlencoded" ? req.bodyText : undefined,
  };

  const libs: Record<string, any> = { "crypto-js": CryptoJS };
  const requireShim = (name: string) => {
    if (libs[name]) return libs[name];
    throw new Error(`Module "${name}" is not available. Built-in: ${Object.keys(libs).join(", ")}`);
  };

  let preError: string | null = null;
  if (req.preScript.trim()) {
    try {
      const fn = new Function("pm", "console", "require", req.preScript);
      fn(buildPm({ variables: varsObj, scriptRequest }), consoleWrap, requireShim);
    } catch (e: any) {
      preError = e.message;
    }
  }

  const subUrl = substituteVars(substitutePathParams(scriptRequest.url, req.pathParams), varsObj) ?? "";
  const subHeaders: [string, string][] = scriptRequest.headers.map((h) => [h.key, substituteVars(h.value, varsObj) ?? ""]);
  let subBody = scriptRequest.body !== undefined ? substituteVars(scriptRequest.body, varsObj) : undefined;
  if (req.bodyMode === "json" && !subHeaders.some(([k]) => k.toLowerCase() === "content-type")) {
    subHeaders.push(["Content-Type", "application/json"]);
  }
  if (req.bodyMode === "urlencoded") {
    subBody = encodeUrlencodedRows(
      req.bodyUrlencoded.map((r) => ({ ...r, value: substituteVars(r.value, varsObj) ?? r.value }))
    );
    if (!subHeaders.some(([k]) => k.toLowerCase() === "content-type")) {
      subHeaders.push(["Content-Type", "application/x-www-form-urlencoded"]);
    }
  }

  const formData =
    req.bodyMode === "form-data"
      ? req.bodyForm
          .filter((f) => f.enabled && f.key.trim())
          .map((f) => ({
            key: f.key,
            value: f.type === "file" ? f.value : substituteVars(f.value, varsObj) ?? "",
            is_file: f.type === "file",
          }))
      : undefined;

  const syncVars = () => {
    const rows: KVRow[] = Object.entries(varsObj)
      .filter(([k]) => k.trim())
      .map(([key, value]) => ({ id: key + ":" + Math.random().toString(36).slice(2), key, value, enabled: true }));
    onVariablesChange(rows.length ? rows : []);
  };

  try {
    const res = await sendHttpRequest({
      method: scriptRequest.method,
      url: subUrl,
      headers: subHeaders,
      body: ["GET", "HEAD"].includes(scriptRequest.method) ? undefined : subBody,
      form_data: ["GET", "HEAD"].includes(scriptRequest.method) ? undefined : formData,
    });

    const scriptResponse = {
      status: res.status,
      statusText: res.status_text,
      time: res.time_ms,
      headers: res.headers,
      body: res.body,
    };

    const testResults: TestResultDraft[] = [];
    if (req.testScript.trim()) {
      try {
        const fn = new Function("pm", "console", "require", req.testScript);
        fn(buildPm({ variables: varsObj, response: scriptResponse, testResults }), consoleWrap, requireShim);
      } catch (e: any) {
        logs.push(`Test script error: ${e.message}`);
      }
    }

    syncVars();

    return {
      status: res.status,
      statusText: res.status_text,
      ok: res.ok,
      time: res.time_ms,
      size: res.size_bytes,
      headers: res.headers,
      body: res.body,
      error: null,
      testResults,
      logs,
      preError,
    };
  } catch (err: any) {
    syncVars();
    return {
      status: null,
      statusText: "",
      ok: false,
      time: 0,
      size: 0,
      headers: [],
      body: "",
      error: `Error: ${err?.message ?? err}`,
      testResults: [],
      logs,
      preError,
    };
  }
}
