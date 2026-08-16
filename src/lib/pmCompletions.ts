// Autocomplete data for the pre-request/test script editors — mirrors the
// actual pm API surface built in pm.ts, not a guess, so suggestions never
// drift from what a script can really call.
export interface CompletionItem {
  label: string;
  detail: string;
  isMethod?: boolean;
  hasArgs?: boolean;
  children?: CompletionItem[];
}

const ENVIRONMENT: CompletionItem = {
  label: "environment",
  detail: "namespace",
  children: [
    { label: "get", detail: "(key: string) => string", isMethod: true, hasArgs: true },
    { label: "set", detail: "(key: string, value: any) => void", isMethod: true, hasArgs: true },
    { label: "unset", detail: "(key: string) => void", isMethod: true, hasArgs: true },
  ],
};

const VARIABLES: CompletionItem = {
  label: "variables",
  detail: "namespace",
  children: [
    { label: "get", detail: "(key: string) => string", isMethod: true, hasArgs: true },
    { label: "set", detail: "(key: string, value: any) => void", isMethod: true, hasArgs: true },
  ],
};

const REQUEST_HEADERS: CompletionItem = {
  label: "headers",
  detail: "namespace",
  children: [
    { label: "add", detail: "({ key, value }) => void", isMethod: true, hasArgs: true },
    { label: "upsert", detail: "({ key, value }) => void", isMethod: true, hasArgs: true },
    { label: "remove", detail: "(key: string) => void", isMethod: true, hasArgs: true },
    { label: "get", detail: "(key: string) => string | undefined", isMethod: true, hasArgs: true },
  ],
};

const REQUEST: CompletionItem = {
  label: "request",
  detail: "namespace",
  children: [
    { label: "method", detail: "string" },
    { label: "url", detail: "string" },
    { label: "body", detail: "{ raw, mode, toString() }" },
    REQUEST_HEADERS,
  ],
};

const RESPONSE_HEADERS: CompletionItem = {
  label: "headers",
  detail: "namespace",
  children: [
    { label: "get", detail: "(key: string) => string | undefined", isMethod: true, hasArgs: true },
  ],
};

const RESPONSE: CompletionItem = {
  label: "response",
  detail: "namespace",
  children: [
    { label: "code", detail: "number | null" },
    { label: "status", detail: "string" },
    { label: "responseTime", detail: "number" },
    RESPONSE_HEADERS,
    { label: "text", detail: "() => string", isMethod: true, hasArgs: false },
    { label: "json", detail: "() => any", isMethod: true, hasArgs: false },
  ],
};

const TEST: CompletionItem = {
  label: "test",
  detail: "(name: string, fn: () => void) => void",
  isMethod: true,
  hasArgs: true,
};

const EXPECT: CompletionItem = {
  label: "expect",
  detail: "(actual: any) => Assertion",
  isMethod: true,
  hasArgs: true,
};

export const PM_PRE_COMPLETIONS: CompletionItem[] = [ENVIRONMENT, VARIABLES, REQUEST];
export const PM_TEST_COMPLETIONS: CompletionItem[] = [ENVIRONMENT, VARIABLES, RESPONSE, TEST, EXPECT];

// pm.expect(actual).to.equal(...) — the ".to." chain isn't reachable by
// walking down from "pm" (there's a function call in between), so it's
// registered as its own completion root, triggered on ".to." wherever it
// appears rather than requiring a literal "pm." prefix.
export const ASSERTION_ROOT: CompletionItem = {
  label: "to",
  detail: "namespace",
  children: [
    { label: "equal", detail: "(expected: any) => void", isMethod: true, hasArgs: true },
    { label: "include", detail: "(expected: any) => void", isMethod: true, hasArgs: true },
    {
      label: "be",
      detail: "namespace",
      children: [
        { label: "above", detail: "(n: number) => void", isMethod: true, hasArgs: true },
        { label: "below", detail: "(n: number) => void", isMethod: true, hasArgs: true },
        { label: "a", detail: "(type: string) => void", isMethod: true, hasArgs: true },
        { label: "ok", detail: "() => void", isMethod: true, hasArgs: false },
      ],
    },
  ],
};
