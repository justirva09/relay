import { TestResultDraft } from "./pm";

// A self-contained runtime, embedded directly into the sandbox iframe's
// `srcdoc` — it CANNOT import anything from this app's bundle, since the
// iframe is a genuinely separate document/global scope (that's the whole
// point: no window.__TAURI_INTERNALS__, no access to this page's JS at
// all). This is a deliberately minimal re-implementation of buildPm() from
// pm.ts — test/expect/environment/variables/request/response only, no
// crypto-js — kept in sync by hand since the two can't share code.
const SANDBOX_RUNTIME = `
(function () {
  function makeExpect(actual) {
    return {
      to: {
        equal: function (exp) { if (actual !== exp) throw new Error("expected " + JSON.stringify(actual) + " to equal " + JSON.stringify(exp)); },
        include: function (exp) { if (!(actual && typeof actual.includes === "function" && actual.includes(exp))) throw new Error("expected " + JSON.stringify(actual) + " to include " + JSON.stringify(exp)); },
        be: {
          above: function (n) { if (!(actual > n)) throw new Error("expected " + actual + " to be above " + n); },
          below: function (n) { if (!(actual < n)) throw new Error("expected " + actual + " to be below " + n); },
          a: function (t) { if (typeof actual !== t) throw new Error("expected type " + typeof actual + " to be " + t); },
          ok: function () { if (!actual) throw new Error("expected value to be truthy"); }
        }
      }
    };
  }

  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (!msg || msg.cmd !== "run") return;

    var variables = Object.assign({}, msg.variables || {});
    var varChanges = {};
    var testResults = [];
    var logs = [];
    var scriptRequest = msg.scriptRequest ? JSON.parse(JSON.stringify(msg.scriptRequest)) : undefined;
    var response = msg.response;
    var error = null;

    var setVar = function (k, v) { variables[k] = v; varChanges[k] = v; };
    var envAPI = { get: function (k) { return variables[k]; }, set: setVar, has: function (k) { return variables[k] !== undefined; } };

    var pm = {
      environment: envAPI,
      variables: envAPI,
      request: scriptRequest ? {
        get url() { return scriptRequest.url; },
        set url(v) { scriptRequest.url = v; },
        method: scriptRequest.method,
        headers: {
          add: function (h) { scriptRequest.headers.push({ key: h.key, value: h.value }); },
          upsert: function (h) {
            var i = scriptRequest.headers.findIndex(function (x) { return x.key.toLowerCase() === String(h.key).toLowerCase(); });
            if (i >= 0) scriptRequest.headers[i] = { key: h.key, value: h.value };
            else scriptRequest.headers.push({ key: h.key, value: h.value });
          }
        }
      } : undefined,
      response: response ? {
        code: response.status,
        status: response.statusText,
        responseTime: response.time,
        headers: { get: function (k) {
          var found = (response.headers || []).find(function (h) { return h[0].toLowerCase() === String(k).toLowerCase(); });
          return found ? found[1] : undefined;
        } },
        text: function () { return response.body; },
        json: function () { return JSON.parse(response.body); }
      } : undefined,
      test: function (name, fn) {
        try { fn(); testResults.push({ name: name, passed: true }); }
        catch (e) { testResults.push({ name: name, passed: false, error: e.message }); }
      },
      expect: makeExpect
    };

    var join = function (args) { return Array.prototype.map.call(args, String).join(" "); };
    var consoleShim = {
      log: function () { logs.push(join(arguments)); },
      info: function () { logs.push(join(arguments)); },
      warn: function () { logs.push(join(arguments)); },
      error: function () { logs.push(join(arguments)); }
    };
    var requireShim = function (name) {
      throw new Error('Module "' + name + '" isn\\'t available in Safe Mode (no filesystem/network access) — switch to Developer Mode if this script needs it.');
    };

    try {
      var fn = new Function("pm", "console", "require", msg.script);
      fn(pm, consoleShim, requireShim);
    } catch (e) {
      error = e && e.message ? e.message : String(e);
    }

    parent.postMessage({ cmd: "result", id: msg.id, testResults: testResults, varChanges: varChanges, scriptRequest: scriptRequest, logs: logs, error: error }, "*");
  });
})();
`;

interface SandboxScriptRequest {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body?: string;
}

interface SandboxResponse {
  status: number | null;
  statusText: string;
  time: number;
  headers: [string, string][];
  body: string;
}

export interface SandboxRunInput {
  script: string;
  variables: Record<string, string>;
  scriptRequest?: SandboxScriptRequest;
  response?: SandboxResponse;
}

export interface SandboxRunResult {
  testResults: TestResultDraft[];
  varChanges: Record<string, string>;
  scriptRequest?: SandboxScriptRequest;
  logs: string[];
  error: string | null;
}

let framePromise: Promise<HTMLIFrameElement> | null = null;
const pending = new Map<number, { resolve: (v: SandboxRunResult) => void; reject: (e: Error) => void }>();
let nextId = 1;

function createSandbox(): Promise<HTMLIFrameElement> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    // The security boundary: "allow-scripts" lets the srcdoc content run JS
    // at all, but deliberately NOT "allow-same-origin" — without it the
    // iframe is treated as opaque-origin, which is what keeps it from ever
    // seeing window.__TAURI_INTERNALS__ (Tauri's IPC bridge, injected only
    // into the app's own top-level document) or anything else on this page.
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.srcdoc = `<!doctype html><html><head></head><body><script>${SANDBOX_RUNTIME}<\/script></body></html>`;
    iframe.onload = () => resolve(iframe);
    document.body.appendChild(iframe);

    window.addEventListener("message", (e) => {
      if (e.source !== iframe.contentWindow) return;
      const msg = e.data;
      if (!msg || msg.cmd !== "result") return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      p.resolve({ testResults: msg.testResults, varChanges: msg.varChanges, scriptRequest: msg.scriptRequest, logs: msg.logs, error: msg.error });
    });
  });
}

function ensureSandbox(): Promise<HTMLIFrameElement> {
  if (!framePromise) framePromise = createSandbox();
  return framePromise;
}

// Runs a pre-request/test script inside the sandbox iframe instead of this
// page's own JS context — used when the workspace has Safe Mode on. See
// SANDBOX_RUNTIME above for what the script actually gets access to.
export async function runInSandbox(input: SandboxRunInput, timeoutMs = 5000): Promise<SandboxRunResult> {
  const iframe = await ensureSandbox();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Script timed out after ${timeoutMs}ms (Safe Mode sandbox limit)`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    iframe.contentWindow!.postMessage({ cmd: "run", id, ...input }, "*");
  });
}
