import { TestResult } from "../types";

// Matched by name so a test present on one side but not the other still
// shows up instead of silently dropping.
export interface TestComparison {
  name: string;
  mock: boolean | null; // null = this test didn't produce a result on this side
  real: boolean | null;
}

export function compareTestResults(mockResults: TestResult[], realResults: TestResult[]): TestComparison[] {
  const names = Array.from(new Set([...mockResults.map((r) => r.name), ...realResults.map((r) => r.name)]));
  return names.map((name) => ({
    name,
    mock: mockResults.find((r) => r.name === name)?.passed ?? null,
    real: realResults.find((r) => r.name === name)?.passed ?? null,
  }));
}

export interface ShapeMismatch {
  path: string;
  mockType: string;
  realType: string;
}

function typeOf(v: any): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

// Walks two JSON values in parallel, flagging type mismatches and keys that
// only exist on one side. Arrays only compare their first element's shape,
// good enough to catch a renamed/retyped field without reconciling
// differently-sized lists.
function walk(mock: any, real: any, path: string, out: ShapeMismatch[]) {
  const mockType = typeOf(mock);
  const realType = typeOf(real);
  if (mockType !== realType) {
    out.push({ path: path || "(root)", mockType, realType });
    return;
  }
  if (mockType === "object") {
    const keys = new Set([...Object.keys(mock), ...Object.keys(real)]);
    for (const key of keys) {
      const inMock = key in mock;
      const inReal = key in real;
      if (!inMock) {
        out.push({ path: joinPath(path, key), mockType: "missing", realType: typeOf(real[key]) });
      } else if (!inReal) {
        out.push({ path: joinPath(path, key), mockType: typeOf(mock[key]), realType: "missing" });
      } else {
        walk(mock[key], real[key], joinPath(path, key), out);
      }
    }
  } else if (mockType === "array" && mock.length && real.length) {
    walk(mock[0], real[0], `${path || "(root)"}[0]`, out);
  }
}

// Returns empty instead of throwing when either side isn't JSON. A contract
// check on a non-JSON API just has nothing to compare structurally.
export function diffJsonShape(mockBody: string, realBody: string): ShapeMismatch[] {
  let mock: any;
  let real: any;
  try {
    mock = JSON.parse(mockBody);
  } catch {
    return [];
  }
  try {
    real = JSON.parse(realBody);
  } catch {
    return [];
  }
  const out: ShapeMismatch[] = [];
  walk(mock, real, "", out);
  return out;
}
