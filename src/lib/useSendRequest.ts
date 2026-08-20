import CryptoJS from "crypto-js";
import { buildPm, substituteVars, substitutePathParams, TestResultDraft } from "./pm";
import { sendHttpRequest } from "./tauri";
import { runInSandbox } from "./scriptSandbox";
import { AuthConfig, Example, KVRow, RequestData, ResponseState, SentRequest, StoredCookie, Workspace, encodeUrlencodedRows } from "../types";
import { signAwsSigV4 } from "./awsSigV4";
import { buildCookieHeaderValue, matchCookiesForUrl, mergeCookies, parseSetCookieHeader } from "./cookies";
import { toBase64 } from "./base64";

const scriptRequire = (name: string) => {
  const libs: Record<string, any> = { "crypto-js": CryptoJS };
  if (libs[name]) return libs[name];
  throw new Error(`Module "${name}" is not available. Built-in: ${Object.keys(libs).join(", ")}`);
};

// Runs this request's testScript against a saved example's status/body
// instead of a live network response — "Run all tests" in ExamplesTab uses
// this to check every scenario's assertions at once without touching the
// network or the mock server at all.
export async function runTestScriptAgainstExample(testScript: string, variables: KVRow[], example: Example, safeMode: boolean): Promise<TestResultDraft[]> {
  if (!testScript.trim()) return [];
  const varsObj: Record<string, string> = {};
  variables.forEach((r) => {
    if (r.key.trim()) varsObj[r.key] = r.value;
  });
  const scriptResponse = { status: example.status, statusText: "", time: 0, headers: example.headers, body: example.body };

  if (safeMode) {
    try {
      const result = await runInSandbox({ script: testScript, variables: varsObj, response: scriptResponse });
      const results = [...result.testResults];
      if (result.error) results.push({ name: "Test script error", passed: false, error: result.error });
      return results;
    } catch (e: any) {
      return [{ name: "Test script error", passed: false, error: e?.message ?? String(e) }];
    }
  }

  const testResults: TestResultDraft[] = [];
  const noop = () => {};
  try {
    const fn = new Function("pm", "console", "require", testScript);
    fn(buildPm({ variables: varsObj, response: scriptResponse, testResults }), { log: noop, info: noop, warn: noop, error: noop }, scriptRequire);
  } catch (e: any) {
    testResults.push({ name: "Test script error", passed: false, error: e?.message ?? String(e) });
  }
  return testResults;
}

// Global variables with the active environment's variables layered on top
// (same precedence store.tsx's sendTab/applyVariableChanges use) — exposed
// here so callers that need the resolved pool without going through a tab's
// send (e.g. the mock-vs-real contract check) don't duplicate the merge.
export function mergedVariables(workspace: Workspace): KVRow[] {
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
  return merged;
}

// Rewrites only the scheme+host+port of an already-fully-resolved URL,
// keeping path/query untouched — used to send the exact same request to the
// mock server instead of the environment's real base_url, without editing
// any variable or environment (see the contract-check feature).
function withOverrideOrigin(url: string, origin: string): string {
  try {
    const u = new URL(url);
    const o = new URL(origin);
    u.protocol = o.protocol;
    u.host = o.host;
    return u.toString();
  } catch {
    return url;
  }
}

// The Auth tab is the source of truth for the Authorization header when set
// (see RequestPanel.tsx, which disables manually editing that header row) —
// computed here and swapped in over whatever's in the raw headers list.
function computeAuthHeader(auth: AuthConfig, varsObj: Record<string, string>): [string, string] | null {
  if (auth.type === "bearer") {
    const token = (substituteVars(auth.bearer?.token ?? "", varsObj) ?? "").trim();
    // Tolerate a variable that already holds the full "Bearer <token>" string
    // (common when migrating off a manually-set Authorization header/variable
    // from before this tab existed) instead of double-prefixing it.
    const value = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    return ["Authorization", value];
  }
  if (auth.type === "basic") {
    const username = (substituteVars(auth.basic?.username ?? "", varsObj) ?? "").trim();
    const password = (substituteVars(auth.basic?.password ?? "", varsObj) ?? "").trim();
    return ["Authorization", `Basic ${toBase64(`${username}:${password}`)}`];
  }
  if (auth.type === "oauth2") {
    const token = auth.oauth2?.accessToken?.trim();
    return token ? ["Authorization", `Bearer ${token}`] : null;
  }
  // awsSigV4 is handled separately (see signAwsSigV4 below) — it needs the
  // fully-resolved method/url/headers/body, not just variable substitution,
  // and produces more than one header.
  return null;
}

export interface RunRequestOptions {
  // Rewrites only the scheme+host+port of the resolved URL — see
  // withOverrideOrigin (used by the mock-vs-real contract check).
  overrideOrigin?: string;
  // Local trust decision (see store.tsx's safeModeKey) — when true, pre/test
  // scripts run inside scriptSandbox.ts's isolated iframe instead of this
  // page's own JS context, so a script from an imported collection can't
  // reach window.__TAURI_INTERNALS__ (filesystem, git, mock server, ...).
  safeMode?: boolean;
  // The local cookie jar (see store.tsx/lib/cookies.ts) — omitted entirely
  // for mock-vs-real contract-check runs, which don't want cookies leaking
  // between the two calls. When provided, matching cookies are sent as a
  // Cookie header (unless the request already sets one manually) and any
  // Set-Cookie response headers are merged back in via onCookiesChange.
  cookies?: StoredCookie[];
  onCookiesChange?: (updated: StoredCookie[]) => void;
}

export async function runRequest(
  req: RequestData,
  variables: KVRow[],
  onVariablesChange: (changed: Record<string, string>) => void,
  opts: RunRequestOptions = {}
): Promise<ResponseState> {
  const { overrideOrigin, safeMode = false } = opts;
  const logs: string[] = [];
  const logFn = (...a: any[]) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  const consoleWrap = { log: logFn, info: logFn, warn: logFn, error: logFn };

  const varsObj: Record<string, string> = {};
  variables.forEach((r) => {
    if (r.key.trim()) varsObj[r.key] = r.value;
  });
  // Snapshot before pre/test scripts run — only keys a script actually
  // changed (via pm.variables.set/pm.environment.set) get written back,
  // instead of re-persisting the whole merged global+environment pool on
  // every send regardless of whether anything changed.
  const initialVarsObj: Record<string, string> = { ...varsObj };

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
    if (safeMode) {
      try {
        const result = await runInSandbox({ script: req.preScript, variables: varsObj, scriptRequest });
        if (result.error) preError = result.error;
        Object.assign(varsObj, result.varChanges);
        if (result.scriptRequest) {
          scriptRequest.url = result.scriptRequest.url;
          scriptRequest.headers = result.scriptRequest.headers;
        }
        logs.push(...result.logs);
      } catch (e: any) {
        preError = e?.message ?? String(e);
      }
    } else {
      try {
        const fn = new Function("pm", "console", "require", req.preScript);
        fn(buildPm({ variables: varsObj, scriptRequest }), consoleWrap, requireShim);
      } catch (e: any) {
        preError = e.message;
      }
    }
  }

  let subUrl = substituteVars(substitutePathParams(scriptRequest.url, req.pathParams), varsObj) ?? "";
  if (overrideOrigin) subUrl = withOverrideOrigin(subUrl, overrideOrigin);
  let subHeaders: [string, string][] = scriptRequest.headers.map((h) => [h.key, substituteVars(h.value, varsObj) ?? ""]);
  const authHeader = computeAuthHeader(req.auth, varsObj);
  if (authHeader) {
    subHeaders = [...subHeaders.filter(([k]) => k.toLowerCase() !== "authorization"), authHeader];
  }
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

  const isBodylessMethod = ["GET", "HEAD"].includes(scriptRequest.method);
  const sentBody = isBodylessMethod ? undefined : subBody ?? (formData ? JSON.stringify(formData, null, 2) : undefined);

  // Only auto-fills the Cookie header when the request doesn't already set
  // one manually — an explicit Headers-tab entry always wins, same
  // precedence Postman/Bruno use.
  if (opts.cookies && !subHeaders.some(([k]) => k.toLowerCase() === "cookie")) {
    const matching = matchCookiesForUrl(opts.cookies, subUrl);
    if (matching.length) subHeaders.push(["Cookie", buildCookieHeaderValue(matching)]);
  }

  // Needs the fully-resolved method/url/headers/body to compute the
  // canonical request, so it runs after every other header/body decision
  // above instead of alongside computeAuthHeader. Doesn't cover form-data —
  // the exact multipart bytes aren't known until Rust's reqwest builds
  // them, so a signed request with a multipart body will fail upstream.
  if (req.auth.type === "awsSigV4" && req.auth.awsSigV4) {
    const signed = await signAwsSigV4(scriptRequest.method, subUrl, subHeaders, sentBody, req.auth.awsSigV4);
    subHeaders = [...subHeaders.filter(([k]) => !signed.some(([sk]) => sk.toLowerCase() === k.toLowerCase())), ...signed];
  }

  const sentRequest: SentRequest = { method: scriptRequest.method, url: subUrl, headers: subHeaders, body: sentBody };

  const syncVars = () => {
    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(varsObj)) {
      if (!k.trim()) continue;
      if (initialVarsObj[k] !== v) changed[k] = v;
    }
    if (Object.keys(changed).length) onVariablesChange(changed);
  };

  try {
    const res = await sendHttpRequest({
      method: scriptRequest.method,
      url: subUrl,
      headers: subHeaders,
      body: isBodylessMethod ? undefined : subBody,
      form_data: isBodylessMethod ? undefined : formData,
      timeout_ms: req.settings.timeoutMs || undefined,
      follow_redirects: req.settings.followRedirects,
      max_redirects: req.settings.maxRedirects,
    });

    if (opts.cookies && opts.onCookiesChange) {
      const incoming = res.headers
        .filter(([k]) => k.toLowerCase() === "set-cookie")
        .map(([, v]) => parseSetCookieHeader(v, subUrl))
        .filter((c): c is StoredCookie => c !== null);
      if (incoming.length) opts.onCookiesChange(mergeCookies(opts.cookies, incoming));
    }

    const scriptResponse = {
      status: res.status,
      statusText: res.status_text,
      time: res.time_ms,
      headers: res.headers,
      body: res.body,
    };

    const testResults: TestResultDraft[] = [];
    if (req.testScript.trim()) {
      if (safeMode) {
        try {
          const result = await runInSandbox({ script: req.testScript, variables: varsObj, response: scriptResponse });
          testResults.push(...result.testResults);
          Object.assign(varsObj, result.varChanges);
          logs.push(...result.logs);
          if (result.error) logs.push(`Test script error: ${result.error}`);
        } catch (e: any) {
          logs.push(`Test script error: ${e?.message ?? String(e)}`);
        }
      } else {
        try {
          const fn = new Function("pm", "console", "require", req.testScript);
          fn(buildPm({ variables: varsObj, response: scriptResponse, testResults }), consoleWrap, requireShim);
        } catch (e: any) {
          logs.push(`Test script error: ${e.message}`);
        }
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
      request: sentRequest,
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
      request: sentRequest,
    };
  }
}
