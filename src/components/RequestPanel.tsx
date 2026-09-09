import React, { useEffect, useMemo, useRef, useState } from "react";
import { RequestData, buildUrlFromParams, parseQueryToRows, parsePathParamsFromUrl, defaultAwsSigV4, defaultOAuth2 } from "../types";
import { runAuthorizationCodePkceFlow } from "../lib/oauth2";
import { mergedVariables } from "../lib/useSendRequest";
import KeyValueEditor, { ValueInput } from "./KeyValueEditor";
import FormDataEditor from "./FormDataEditor";
import CodeEditor from "./CodeEditor";
import ResizableCodeEditor from "./ResizableCodeEditor";
import CodeSnippetModal from "./CodeSnippetModal";
import { PM_PRE_COMPLETIONS, PM_TEST_COMPLETIONS } from "../lib/pmCompletions";
import { useWorkspace } from "../store";
import { VariableGroup } from "../lib/useVariableMenu";
import SimpleSelect from "./SimpleSelect";
import ApiHistoryPanel from "./ApiHistoryPanel";
import ContractCheckModal from "./ContractCheckModal";
import { renderMarkdown } from "../lib/markdown";
import { buildVariableInfo } from "../lib/useVariableHover";
import InfoTooltip from "./InfoTooltip";
import ToggleSwitch from "./ToggleSwitch";
import { hasFeature, subscribeLicense } from "../lib/license";
import { runAction } from "../lib/keybindings";
import UrlInput from "./requestPanel/UrlInput";
import MethodDropdown from "./requestPanel/MethodDropdown";
import AutoHeadersList from "./requestPanel/AutoHeadersList";
import ExamplesTab from "./requestPanel/ExamplesTab";
import { METHOD_COLOR } from "./requestPanel/shared";
import { COMMON_HTTP_HEADERS } from "../lib/httpHeaders";

const PRE_PLACEHOLDER = `// runs before the request is sent
// pm.environment.set("token", "abc123")
// pm.request.headers.add({ key: "X-Trace", value: Date.now() })
// pm.request.url = pm.request.url + "&debug=1"`;

const TEST_PLACEHOLDER = `// runs after the response comes back
// pm.test("status is 200", () => pm.expect(pm.response.code).to.equal(200))
// pm.test("has id", () => pm.expect(pm.response.json().id).to.be.a("number"))
// pm.environment.set("lastId", pm.response.json().id)`;

interface Props {
  nodeId: string;
  draft: RequestData;
  loading: boolean;
  dirty: boolean;
  onChange: (patch: Partial<RequestData>) => void;
  onSend: () => void;
  onSave: () => void;
}

export default function RequestPanel({ nodeId, draft, loading, dirty, onChange, onSend, onSave }: Props) {
  const [reqTab, setReqTab] = useState<"docs" | "params" | "auth" | "headers" | "body" | "examples" | "scripts" | "settings" | "history">("params");
  const [docsMode, setDocsMode] = useState<"edit" | "preview">("edit");
  const [scriptTab, setScriptTab] = useState<"pre" | "post">("pre");
  const [showSnippet, setShowSnippet] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const methodColor = METHOD_COLOR[draft.method] || METHOD_COLOR.GET;
  // re-render on license change, so the gate state doesn't go stale
  const [, forceLicenseRerender] = useState(0);
  useEffect(() => subscribeLicense(() => forceLicenseRerender((n) => n + 1)), []);

  const { workspace, mockServerRunningPort, safeMode } = useWorkspace();
  const [showContractCheck, setShowContractCheck] = useState(false);
  // grouped by scope so the {{variable}} completion menu can show where
  // each suggestion comes from (Global, or a specific environment)
  const variableGroups = useMemo(() => {
    const groups: VariableGroup[] = [];
    const globalNames = workspace.variables.filter((v) => v.key.trim()).map((v) => v.key);
    if (globalNames.length) groups.push({ category: "Global", names: globalNames });
    for (const env of workspace.environments) {
      const names = env.variables.filter((v) => v.key.trim()).map((v) => v.key);
      if (names.length) groups.push({ category: env.name, names });
    }
    return groups;
  }, [workspace.variables, workspace.environments]);

  const variables = useMemo(() => mergedVariables(workspace), [workspace]);
  const variableInfo = useMemo(() => buildVariableInfo(workspace), [workspace]);

  const handleUrlChange = (val: string) => {
    onChange({
      url: val,
      params: parseQueryToRows(val, draft.params),
      pathParams: parsePathParamsFromUrl(val, draft.pathParams),
    });
  };
  const handleParamsChange = (rows: RequestData["params"]) => {
    onChange({ params: rows, url: buildUrlFromParams(draft.url, rows, draft.settings.encodeUrl) });
  };
  const handlePathParamChange = (id: string, value: string) => {
    onChange({ pathParams: draft.pathParams.map((r) => (r.id === id ? { ...r, value } : r)) });
  };

  const enabledParams = draft.params.filter((p) => p.enabled && p.key.trim()).length;
  const enabledHeaders = draft.headers.filter((h) => h.enabled && h.key.trim()).length;
  const hasBody =
    draft.bodyMode === "json" || draft.bodyMode === "text"
      ? draft.bodyText.trim().length > 0
      : draft.bodyMode === "form-data"
      ? draft.bodyForm.some((f) => f.enabled && f.key.trim())
      : draft.bodyMode === "urlencoded"
      ? draft.bodyUrlencoded.some((r) => r.enabled && r.key.trim())
      : false;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 flex items-center gap-2">
        <MethodDropdown value={draft.method} onChange={(m) => onChange({ method: m })} />
        <UrlInput
          value={draft.url}
          onChange={handleUrlChange}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="https://api.example.com/endpoint?key=value"
          variables={variableGroups}
          variableInfo={variableInfo}
        />
        <button
          title="Code snippet"
          onClick={() => setShowSnippet(true)}
          className="h-[36px] w-[36px] grid place-items-center rounded-md border border-transparent ring-1 ring-th-border-input text-th-text-3 hover:text-th-accent-text hover:bg-th-hover shrink-0"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
        <button
          onClick={onSave}
          disabled={!dirty}
          className={`px-3 py-2 rounded-md text-[13px] font-semibold border border-transparent transition-colors shrink-0 ${
            dirty ? "bg-th-surface text-th-text-1 ring-1 ring-th-border-input hover:bg-th-hover" : "bg-th-surface/50 text-th-text-4 ring-1 ring-th-border cursor-default"
          }`}
        >
          Save
        </button>
        <button
          onClick={onSend}
          disabled={loading}
          className="px-4 py-2 rounded-md text-[13px] font-semibold border border-transparent bg-th-accent text-white hover:bg-th-accent-hover transition-colors shrink-0 disabled:opacity-60"
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>

      <div className="px-4 mt-4">
        <div className="flex items-center gap-4 border-b border-th-border text-[12.5px] font-mono overflow-x-auto overflow-y-hidden">
          {[
            ["docs", "Docs"],
            ["params", `Params${enabledParams ? ` (${enabledParams})` : ""}`],
            ["auth", "Auth"],
            ["headers", `Headers${enabledHeaders ? ` (${enabledHeaders})` : ""}`],
            ["body", "Body"],
            ["examples", `Examples${draft.examples.length ? ` (${draft.examples.length})` : ""}`],
            ["scripts", "Scripts"],
            ["settings", "Settings"],
            ["history", "History"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setReqTab(key as any)}
              className={`pb-2 -mb-px border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                reqTab === key ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"
              }`}
            >
              {label}
              {key === "docs" && draft.description.trim() && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "auth" && draft.auth.type !== "none" && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "body" && hasBody && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "scripts" && (draft.preScript.trim() || draft.testScript.trim()) && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "examples" && draft.examples.length > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
              {key === "settings" && draft.tags.length > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 flex-1 min-h-0 flex flex-col">
        {reqTab === "docs" && (
          <div className="flex flex-col flex-1 min-h-0 gap-1.5">
            <div className="flex items-center gap-1 shrink-0">
              {(["edit", "preview"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDocsMode(m)}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-mono capitalize ring-1 transition-colors ${
                    docsMode === m ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {docsMode === "edit" ? (
              <textarea
                value={draft.description}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="Describe what this request does, its parameters, and anything else teammates should know… (Markdown supported)"
                className="flex-1 min-h-0 resize-none bg-th-surface border border-th-border-input rounded-md px-3 py-2.5 text-[13px] font-sans leading-relaxed text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto bg-th-surface border border-th-border-input rounded-md px-4 py-3">
                {draft.description.trim() ? (
                  <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.description) }} />
                ) : (
                  <span className="text-[13px] text-th-text-4">Nothing here yet — switch to Edit to write a description.</span>
                )}
              </div>
            )}
          </div>
        )}
        {reqTab === "params" && (
          <div className="flex flex-col gap-4 pb-4">
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Query Params</p>
              <KeyValueEditor rows={draft.params} onChangeRows={handleParamsChange} placeholderKey="param" placeholderVal="value" variables={variableGroups} variableInfo={variableInfo} />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide">Path Variables</p>
                <InfoTooltip text="Auto-detected from :placeholders in the URL (e.g. /users/:id). Add one to the URL and it shows up here to set its value." />
              </div>
              {draft.pathParams.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {draft.pathParams.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span
                        className="flex-1 min-w-0 truncate px-2.5 py-1.5 text-[13px] font-mono text-sky-400"
                        title={p.key}
                      >
                        :{p.key}
                      </span>
                      <ValueInput
                        value={p.value}
                        onChange={(v) => handlePathParamChange(p.id, v)}
                        placeholder="value"
                        variables={variableGroups}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-th-text-4 font-mono">no :placeholders in the URL yet</span>
              )}
            </div>
          </div>
        )}
        {reqTab === "auth" && (
          <div className="flex flex-col gap-3 max-w-md pb-4">
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Type</p>
              <SimpleSelect
                value={draft.auth.type}
                onChange={(type) => onChange({ auth: { ...draft.auth, type } })}
                options={[
                  { value: "none", label: "No Auth" },
                  { value: "bearer", label: "Bearer Token" },
                  { value: "basic", label: "Basic Auth" },
                  { value: "awsSigV4", label: "AWS Signature v4" },
                  { value: "oauth2", label: "OAuth 2.0" },
                ]}
              />
            </div>
            {draft.auth.type === "bearer" && (
              <div>
                <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Token</p>
                <ValueInput
                  value={draft.auth.bearer?.token ?? ""}
                  onChange={(v) => onChange({ auth: { type: "bearer", bearer: { token: v } } })}
                  placeholder="{{token}}"
                  variables={variableGroups}
                />
              </div>
            )}
            {draft.auth.type === "basic" && (
              <>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Username</p>
                  <ValueInput
                    value={draft.auth.basic?.username ?? ""}
                    onChange={(v) =>
                      onChange({ auth: { type: "basic", basic: { username: v, password: draft.auth.basic?.password ?? "" } } })
                    }
                    placeholder="username"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Password</p>
                  <ValueInput
                    value={draft.auth.basic?.password ?? ""}
                    onChange={(v) =>
                      onChange({ auth: { type: "basic", basic: { username: draft.auth.basic?.username ?? "", password: v } } })
                    }
                    placeholder="password"
                    variables={variableGroups}
                  />
                </div>
              </>
            )}
            {draft.auth.type === "awsSigV4" && (
              <>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Access Key ID</p>
                  <ValueInput
                    value={draft.auth.awsSigV4?.accessKeyId ?? ""}
                    onChange={(v) => onChange({ auth: { type: "awsSigV4", awsSigV4: { ...(draft.auth.awsSigV4 ?? defaultAwsSigV4()), accessKeyId: v } } })}
                    placeholder="AKIA…"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Secret Access Key</p>
                  <ValueInput
                    value={draft.auth.awsSigV4?.secretAccessKey ?? ""}
                    onChange={(v) => onChange({ auth: { type: "awsSigV4", awsSigV4: { ...(draft.auth.awsSigV4 ?? defaultAwsSigV4()), secretAccessKey: v } } })}
                    placeholder="{{aws_secret}}"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Session Token (optional)</p>
                  <ValueInput
                    value={draft.auth.awsSigV4?.sessionToken ?? ""}
                    onChange={(v) => onChange({ auth: { type: "awsSigV4", awsSigV4: { ...(draft.auth.awsSigV4 ?? defaultAwsSigV4()), sessionToken: v } } })}
                    placeholder="for temporary STS credentials"
                    variables={variableGroups}
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Region</p>
                    <ValueInput
                      value={draft.auth.awsSigV4?.region ?? ""}
                      onChange={(v) => onChange({ auth: { type: "awsSigV4", awsSigV4: { ...(draft.auth.awsSigV4 ?? defaultAwsSigV4()), region: v } } })}
                      placeholder="us-east-1"
                      variables={variableGroups}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Service</p>
                    <ValueInput
                      value={draft.auth.awsSigV4?.service ?? ""}
                      onChange={(v) => onChange({ auth: { type: "awsSigV4", awsSigV4: { ...(draft.auth.awsSigV4 ?? defaultAwsSigV4()), service: v } } })}
                      placeholder="execute-api"
                      variables={variableGroups}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-th-text-4">Doesn't cover multipart form-data bodies — the signed payload hash needs the exact bytes Rust builds for those.</p>
              </>
            )}
            {draft.auth.type === "oauth2" && (
              <>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Authorization URL</p>
                  <ValueInput
                    value={draft.auth.oauth2?.authUrl ?? ""}
                    onChange={(v) => onChange({ auth: { type: "oauth2", oauth2: { ...(draft.auth.oauth2 ?? defaultOAuth2()), authUrl: v } } })}
                    placeholder="https://provider.com/oauth/authorize"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Token URL</p>
                  <ValueInput
                    value={draft.auth.oauth2?.tokenUrl ?? ""}
                    onChange={(v) => onChange({ auth: { type: "oauth2", oauth2: { ...(draft.auth.oauth2 ?? defaultOAuth2()), tokenUrl: v } } })}
                    placeholder="https://provider.com/oauth/token"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Client ID</p>
                  <ValueInput
                    value={draft.auth.oauth2?.clientId ?? ""}
                    onChange={(v) => onChange({ auth: { type: "oauth2", oauth2: { ...(draft.auth.oauth2 ?? defaultOAuth2()), clientId: v } } })}
                    placeholder="client id"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Client Secret (optional)</p>
                  <ValueInput
                    value={draft.auth.oauth2?.clientSecret ?? ""}
                    onChange={(v) => onChange({ auth: { type: "oauth2", oauth2: { ...(draft.auth.oauth2 ?? defaultOAuth2()), clientSecret: v } } })}
                    placeholder="only if the provider requires it for a public/PKCE client"
                    variables={variableGroups}
                  />
                </div>
                <div>
                  <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Scope</p>
                  <ValueInput
                    value={draft.auth.oauth2?.scope ?? ""}
                    onChange={(v) => onChange({ auth: { type: "oauth2", oauth2: { ...(draft.auth.oauth2 ?? defaultOAuth2()), scope: v } } })}
                    placeholder="openid profile email"
                    variables={variableGroups}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-1.5">
                    <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide">Redirect Port</p>
                    <InfoTooltip text="Relay opens your system browser to authorize, then catches the redirect on this local port (http://127.0.0.1:<port>/callback) — set this in your OAuth app's allowed redirect URIs." />
                  </div>
                </div>
                <input
                  type="number"
                  value={draft.auth.oauth2?.redirectPort ?? defaultOAuth2().redirectPort}
                  onChange={(e) =>
                    onChange({
                      auth: {
                        type: "oauth2",
                        oauth2: { ...(draft.auth.oauth2 ?? defaultOAuth2()), redirectPort: Math.max(1, Number(e.target.value) || 0) },
                      },
                    })
                  }
                  className="w-28 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
                />

                <div className="border-t border-th-border pt-3 flex flex-col gap-2">
                  <button
                    disabled={oauthLoading}
                    onClick={async () => {
                      setOauthLoading(true);
                      setOauthError(null);
                      try {
                        const config = draft.auth.oauth2 ?? defaultOAuth2();
                        const result = await runAuthorizationCodePkceFlow(config);
                        onChange({
                          auth: {
                            type: "oauth2",
                            oauth2: { ...config, accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: result.expiresAt },
                          },
                        });
                      } catch (e: any) {
                        setOauthError(e?.message ?? String(e));
                      } finally {
                        setOauthLoading(false);
                      }
                    }}
                    className="self-start px-3 py-1.5 rounded-md text-[12.5px] font-semibold bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-60 transition-colors"
                  >
                    {oauthLoading ? "Waiting for browser…" : "Get New Access Token"}
                  </button>
                  {oauthError && <p className="text-[11.5px] text-rose-400">{oauthError}</p>}
                  {draft.auth.oauth2?.accessToken && (
                    <p className="text-[11.5px] text-emerald-400 font-mono">
                      Token acquired{draft.auth.oauth2.expiresAt ? ` · expires ${new Date(draft.auth.oauth2.expiresAt).toLocaleTimeString()}` : ""}
                    </p>
                  )}
                </div>
              </>
            )}
            {draft.auth.type !== "none" && draft.auth.type !== "oauth2" && (
              <p className="text-[11.5px] text-th-text-4">
                Sets the <span className="font-mono">Authorization</span> header at send time — the row in the Headers tab is locked while this is active.
              </p>
            )}
            {draft.auth.type === "oauth2" && (
              <p className="text-[11.5px] text-th-text-4">
                Sets the <span className="font-mono">Authorization</span> header from the acquired access token — no auto-refresh yet, re-run "Get New Access Token" once it expires.
              </p>
            )}
          </div>
        )}
        {reqTab === "headers" && (
          <>
            <AutoHeadersList draft={draft} />
            <KeyValueEditor
              rows={draft.headers}
              onChangeRows={(rows) => onChange({ headers: rows })}
              placeholderKey="header"
              placeholderVal="value"
              variables={variableGroups}
              variableInfo={variableInfo}
              keySuggestions={COMMON_HTTP_HEADERS}
              lockedKeys={draft.auth.type !== "none" ? ["authorization"] : undefined}
            />
          </>
        )}
        {reqTab === "body" && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              {(["none", "json", "text", "form-data", "urlencoded"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onChange({ bodyMode: m })}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-mono ring-1 transition-colors ${
                    draft.bodyMode === m ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {draft.bodyMode === "form-data" && (
              <FormDataEditor rows={draft.bodyForm} onChangeRows={(bodyForm) => onChange({ bodyForm })} variables={variableGroups} variableInfo={variableInfo} />
            )}
            {draft.bodyMode === "urlencoded" && (
              <KeyValueEditor
                rows={draft.bodyUrlencoded}
                onChangeRows={(bodyUrlencoded) => onChange({ bodyUrlencoded })}
                placeholderKey="key"
                placeholderVal="value"
                variables={variableGroups}
                variableInfo={variableInfo}
              />
            )}
            {draft.bodyMode !== "none" && draft.bodyMode !== "form-data" && draft.bodyMode !== "urlencoded" && (
              <div className="flex flex-col gap-1.5">
                {draft.bodyMode === "json" && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        try {
                          const formatted = JSON.stringify(JSON.parse(draft.bodyText), null, 2);
                          onChange({ bodyText: formatted });
                        } catch {}
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-mono text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
                    >
                      Prettify
                    </button>
                  </div>
                )}
                <ResizableCodeEditor
                  value={draft.bodyText}
                  onChange={(v) => onChange({ bodyText: v })}
                  placeholder={draft.bodyMode === "json" ? '{\n  "key": "value",\n  "token": "{{token}}"\n}' : "raw text body"}
                  variables={variableGroups}
                  storageKey="relay-http-request-body-height"
                  defaultHeight={264}
                  resizeLabel="HTTP request body editor"
                  className="bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
                />
              </div>
            )}
          </div>
        )}
        {reqTab === "scripts" && (
          <div className="flex gap-3 flex-1 min-h-0">
            <div className="w-[130px] shrink-0 flex flex-col gap-0.5">
              {(
                [
                  ["pre", "Pre-request", draft.preScript],
                  ["post", "Post-response", draft.testScript],
                ] as const
              ).map(([key, label, script]) => (
                <button
                  key={key}
                  onClick={() => setScriptTab(key)}
                  className={`px-2.5 py-1.5 rounded-md text-[12.5px] text-left flex items-center justify-between gap-1.5 transition-colors ${
                    scriptTab === key ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-2 hover:text-th-text-1 hover:bg-th-hover"
                  }`}
                >
                  {label}
                  {script.trim() && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-1.5">
              {scriptTab === "pre" ? (
                <>
                  <CodeEditor
                    value={draft.preScript}
                    onChange={(v) => onChange({ preScript: v })}
                    placeholder={PRE_PLACEHOLDER}
                    completions={PM_PRE_COMPLETIONS}
                    variables={variableGroups}
                    className="flex-1 min-h-0 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
                  />
                  <span className="text-[11px] text-th-text-4 font-mono shrink-0">runs before send · pm.environment, pm.variables, pm.request, crypto (CryptoJS), require("crypto-js")</span>
                </>
              ) : (
                <>
                  <CodeEditor
                    value={draft.testScript}
                    onChange={(v) => onChange({ testScript: v })}
                    placeholder={TEST_PLACEHOLDER}
                    completions={PM_TEST_COMPLETIONS}
                    variables={variableGroups}
                    className="flex-1 min-h-0 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
                  />
                  <span className="text-[11px] text-th-text-4 font-mono shrink-0">runs after response · pm.test, pm.expect, pm.response</span>
                </>
              )}
            </div>
          </div>
        )}
        {reqTab === "examples" && (
          <ExamplesTab
            examples={draft.examples}
            onChange={(examples) => onChange({ examples })}
            testScript={draft.testScript}
            variables={variables}
            safeMode={safeMode}
            mockPort={mockServerRunningPort}
            onCompareVsMock={() => (hasFeature("contract.check") ? setShowContractCheck(true) : runAction("view.settings"))}
            contractCheckEntitled={hasFeature("contract.check")}
          />
        )}
        {reqTab === "settings" && (
          <div className="flex flex-col gap-5 max-w-xl pb-4">
            <p className="text-[12px] text-th-text-3">Configure request settings for this item.</p>

            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Tags</p>
              <input
                value={draft.tags.join(", ")}
                onChange={(e) =>
                  onChange({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="e.g., smoke, regression"
                className="w-full bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-th-text-1">URL Encoding</p>
                <p className="text-[11.5px] text-th-text-3">Automatically encode query parameters in the URL</p>
              </div>
              <ToggleSwitch checked={draft.settings.encodeUrl} onChange={(v) => onChange({ settings: { ...draft.settings, encodeUrl: v } })} />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-th-text-1">Automatically Follow Redirects</p>
                <p className="text-[11.5px] text-th-text-3">Follow HTTP redirects automatically</p>
              </div>
              <ToggleSwitch checked={draft.settings.followRedirects} onChange={(v) => onChange({ settings: { ...draft.settings, followRedirects: v } })} />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-th-text-1">Max Redirects</p>
                <p className="text-[11.5px] text-th-text-3">Set a limit for the number of redirects to follow</p>
              </div>
              <input
                type="number"
                min={0}
                value={draft.settings.maxRedirects}
                onChange={(e) => onChange({ settings: { ...draft.settings, maxRedirects: Math.max(0, Number(e.target.value) || 0) } })}
                className="w-20 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-th-text-1">Timeout (ms)</p>
                <p className="text-[11.5px] text-th-text-3">Set maximum time to wait before aborting the request — 0 uses Relay's default</p>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={draft.settings.timeoutMs}
                  onChange={(e) => onChange({ settings: { ...draft.settings, timeoutMs: Math.max(0, Number(e.target.value) || 0) } })}
                  className="w-24 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[13px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
                />
                {draft.settings.timeoutMs > 0 && (
                  <button
                    onClick={() => onChange({ settings: { ...draft.settings, timeoutMs: 0 } })}
                    title="Reset to default"
                    className="shrink-0 h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-th-text-1 hover:bg-th-hover"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {reqTab === "history" && <ApiHistoryPanel nodeId={nodeId} />}
      </div>

      {showSnippet && <CodeSnippetModal draft={draft} onClose={() => setShowSnippet(false)} />}
      {showContractCheck && mockServerRunningPort && (
        <ContractCheckModal draft={draft} mockPort={mockServerRunningPort} onClose={() => setShowContractCheck(false)} />
      )}
    </div>
  );
}
