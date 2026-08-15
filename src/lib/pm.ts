export interface ScriptRequest {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body?: string;
}

export interface ScriptResponse {
  status: number | null;
  statusText: string;
  time: number;
  headers: [string, string][];
  body: string;
}

export interface TestResultDraft {
  name: string;
  passed: boolean;
  error?: string;
}

export function substituteVars(text: string | undefined, vars: Record<string, string>): string | undefined {
  if (typeof text !== "string") return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => (vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`));
}

function makeExpect(actual: any) {
  return {
    to: {
      equal: (exp: any) => {
        if (actual !== exp) throw new Error(`expected ${JSON.stringify(actual)} to equal ${JSON.stringify(exp)}`);
      },
      include: (exp: any) => {
        if (!(actual && typeof actual.includes === "function" && actual.includes(exp)))
          throw new Error(`expected ${JSON.stringify(actual)} to include ${JSON.stringify(exp)}`);
      },
      be: {
        above: (n: number) => {
          if (!(actual > n)) throw new Error(`expected ${actual} to be above ${n}`);
        },
        below: (n: number) => {
          if (!(actual < n)) throw new Error(`expected ${actual} to be below ${n}`);
        },
        a: (t: string) => {
          if (typeof actual !== t) throw new Error(`expected type ${typeof actual} to be ${t}`);
        },
        ok: () => {
          if (!actual) throw new Error("expected value to be truthy");
        },
      },
    },
  };
}

export function buildPm(opts: {
  variables: Record<string, string>;
  scriptRequest?: ScriptRequest;
  response?: ScriptResponse;
  testResults?: TestResultDraft[];
}) {
  const { variables, scriptRequest, response, testResults } = opts;

  const headersAPI = {
    add: (h: { key: string; value: string }) => scriptRequest?.headers.push({ key: h.key, value: h.value }),
    upsert: (h: { key: string; value: string }) => {
      if (!scriptRequest) return;
      const i = scriptRequest.headers.findIndex((x) => x.key.toLowerCase() === String(h.key).toLowerCase());
      if (i >= 0) scriptRequest.headers[i] = { key: h.key, value: h.value };
      else scriptRequest.headers.push({ key: h.key, value: h.value });
    },
    remove: (key: string) => {
      if (!scriptRequest) return;
      scriptRequest.headers = scriptRequest.headers.filter((x) => x.key.toLowerCase() !== String(key).toLowerCase());
    },
    get: (key: string) => scriptRequest?.headers.find((x) => x.key.toLowerCase() === String(key).toLowerCase())?.value,
  };

  return {
    environment: {
      get: (k: string) => variables[k],
      set: (k: string, v: any) => {
        variables[k] = String(v);
      },
      unset: (k: string) => {
        delete variables[k];
      },
    },
    variables: {
      get: (k: string) => variables[k],
      set: (k: string, v: any) => {
        variables[k] = String(v);
      },
    },
    request: scriptRequest
      ? {
          get method() {
            return scriptRequest.method;
          },
          set method(v: string) {
            scriptRequest.method = v;
          },
          get url() {
            return scriptRequest.url;
          },
          set url(v: string) {
            scriptRequest.url = v;
          },
          get body() {
            const raw = scriptRequest.body ?? "";
            return { raw, mode: "raw", toString: () => raw };
          },
          set body(v: any) {
            scriptRequest.body = typeof v === "object" && v !== null ? v.raw : v;
          },
          headers: headersAPI,
        }
      : undefined,
    response: response
      ? {
          code: response.status,
          status: response.statusText,
          responseTime: response.time,
          headers: { get: (k: string) => response.headers.find(([hk]) => hk.toLowerCase() === k.toLowerCase())?.[1] },
          text: () => response.body,
          json: () => JSON.parse(response.body),
        }
      : undefined,
    test: testResults
      ? (name: string, fn: () => void) => {
          try {
            fn();
            testResults.push({ name, passed: true });
          } catch (e: any) {
            testResults.push({ name, passed: false, error: e.message });
          }
        }
      : undefined,
    expect: makeExpect,
  };
}
