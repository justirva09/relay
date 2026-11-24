import { TreeNode, FolderNode, RequestNode, KVRow, Method, BodyMode, FormDataRow, AuthConfig, Environment, defaultAuth, defaultRequest, defaultRequestSettings, newRow, newFormDataRow, uid, parseQueryToRows, parsePathParamsFromUrl } from "../types";
import { rewriteScriptNamespace } from "./scriptDialect";

const POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanFormDataField {
  key: string;
  value?: string;
  src?: string;
  type?: "text" | "file";
  disabled?: boolean;
}

interface PostmanUrlencodedField {
  key: string;
  value?: string;
  disabled?: boolean;
}

interface PostmanBody {
  mode?: string;
  raw?: string;
  options?: { raw?: { language?: string } };
  formdata?: PostmanFormDataField[];
  urlencoded?: PostmanUrlencodedField[];
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: { key: string; value: string; disabled?: boolean }[];
}

interface PostmanAuthField {
  key: string;
  value?: string;
  type?: string;
}

interface PostmanAuth {
  type: string;
  bearer?: PostmanAuthField[];
  basic?: PostmanAuthField[];
}

interface PostmanRequest {
  method?: string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  url?: string | PostmanUrl;
  description?: string | { content?: string };
  auth?: PostmanAuth;
}

function extractDescription(desc: string | { content?: string } | undefined): string {
  if (!desc) return "";
  return typeof desc === "string" ? desc : desc.content || "";
}

function fieldValue(fields: PostmanAuthField[] | undefined, key: string): string {
  return fields?.find((f) => f.key === key)?.value ?? "";
}

function parsePostmanAuth(auth: PostmanAuth | undefined): AuthConfig {
  if (!auth) return defaultAuth();
  if (auth.type === "bearer") {
    return { type: "bearer", bearer: { token: fieldValue(auth.bearer, "token") } };
  }
  if (auth.type === "basic") {
    return { type: "basic", basic: { username: fieldValue(auth.basic, "username"), password: fieldValue(auth.basic, "password") } };
  }
  return defaultAuth();
}

function authToPostman(auth: AuthConfig): PostmanAuth | undefined {
  if (auth.type === "bearer") {
    return { type: "bearer", bearer: [{ key: "token", value: auth.bearer?.token ?? "", type: "string" }] };
  }
  if (auth.type === "basic") {
    return {
      type: "basic",
      basic: [
        { key: "username", value: auth.basic?.username ?? "", type: "string" },
        { key: "password", value: auth.basic?.password ?? "", type: "string" },
      ],
    };
  }
  return undefined;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  event?: PostmanEvent[];
}

interface PostmanEvent {
  listen?: "prerequest" | "test" | string;
  script?: { exec?: string[] | string; type?: string };
  disabled?: boolean;
}

interface PostmanCollection {
  info?: { name?: string; schema?: string; _postman_id?: string };
  item?: PostmanItem[];
  variable?: { key: string; value: string; type?: string; disabled?: boolean }[];
  event?: PostmanEvent[];
}

export function isPostmanCollection(data: any): data is PostmanCollection {
  return data?.info?.schema?.includes("getpostman.com") || (data?.info && Array.isArray(data?.item));
}

interface PostmanEnvironment {
  id?: string;
  name?: string;
  values?: { key?: string; value?: unknown; enabled?: boolean; type?: string }[];
  _postman_variable_scope?: string;
}

export function isPostmanEnvironment(data: any): data is PostmanEnvironment {
  return Array.isArray(data?.values) && (data?._postman_variable_scope === "environment" || !data?.item);
}

export function postmanEnvironmentToRelay(data: PostmanEnvironment): Environment {
  return {
    id: uid(),
    name: data.name || "Postman Environment",
    variables: (data.values || []).map((item) => ({
      id: uid(), key: item.key || "", value: typeof item.value === "string" ? item.value : JSON.stringify(item.value ?? ""),
      enabled: item.enabled !== false, secret: item.type === "secret",
    })),
  };
}

export function isRelayWorkspace(data: any): boolean {
  return Array.isArray(data?.tree);
}

function extractUrl(url: string | PostmanUrl | undefined): string {
  if (!url) return "";
  if (typeof url === "string") return url;
  return url.raw || "";
}

function eventScripts(events: PostmanEvent[] | undefined, listen: string): string[] {
  return (events ?? [])
    .filter((event) => event.listen === listen && !event.disabled)
    .map((event) => Array.isArray(event.script?.exec) ? event.script.exec.join("\n") : event.script?.exec ?? "")
    .filter((script) => script.trim())
    .map((script) => rewriteScriptNamespace(script, "pm", "relay"));
}

function parsePostmanItem(item: PostmanItem, inheritedPre: string[], inheritedPost: string[]): TreeNode {
  const pre = [...inheritedPre, ...eventScripts(item.event, "prerequest")];
  const post = [...inheritedPost, ...eventScripts(item.event, "test")];
  if (item.item && !item.request) {
    const folder: FolderNode = {
      id: uid(),
      kind: "folder",
      name: item.name || "Folder",
      children: item.item.map((child) => parsePostmanItem(child, pre, post)),
    };
    return folder;
  }

  const req = item.request || {};
  const method = ((req.method || "GET").toUpperCase()) as Method;
  const rawUrl = extractUrl(req.url);

  const headers: KVRow[] = (req.header || []).map((h) => ({
    id: uid(),
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }));
  if (headers.length === 0 || headers[headers.length - 1].key.trim()) {
    headers.push(newRow());
  }

  let bodyMode: BodyMode = "none";
  let bodyText = "";
  let bodyForm: FormDataRow[] = [newFormDataRow()];
  let bodyUrlencoded: KVRow[] = [newRow()];
  if (req.body) {
    if (req.body.mode === "raw" && req.body.raw !== undefined) {
      bodyText = req.body.raw;
      bodyMode = req.body.options?.raw?.language === "json" ? "json" : "text";
      if (bodyMode === "text") {
        try {
          JSON.parse(bodyText);
          bodyMode = "json";
        } catch {}
      }
    } else if (req.body.mode === "formdata" && Array.isArray(req.body.formdata)) {
      bodyMode = "form-data";
      bodyForm = req.body.formdata.map((f: any) => ({
        id: uid(),
        key: f.key ?? "",
        value: f.type === "file" ? f.src ?? "" : f.value ?? "",
        enabled: !f.disabled,
        type: f.type === "file" ? "file" : "text",
      }));
      if (bodyForm.length === 0) bodyForm = [newFormDataRow()];
    } else if (req.body.mode === "urlencoded" && Array.isArray(req.body.urlencoded)) {
      bodyMode = "urlencoded";
      bodyUrlencoded = req.body.urlencoded.map((f: any) => ({
        id: uid(),
        key: f.key ?? "",
        value: f.value ?? "",
        enabled: !f.disabled,
      }));
      if (bodyUrlencoded.length === 0) bodyUrlencoded = [newRow()];
    }
  }

  const node: RequestNode = {
    id: uid(),
    kind: "request",
    name: item.name || "Request",
    request: {
      method,
      url: rawUrl,
      description: extractDescription(req.description),
      params: parseQueryToRows(rawUrl),
      pathParams: parsePathParamsFromUrl(rawUrl),
      headers,
      auth: parsePostmanAuth(req.auth),
      bodyMode,
      bodyText,
      bodyForm,
      bodyUrlencoded,
      preScript: pre.join("\n\n"),
      testScript: post.join("\n\n"),
      examples: [],
      tags: [],
      settings: defaultRequestSettings(),
    },
  };
  return node;
}

export function postmanToTree(data: PostmanCollection): { tree: TreeNode[]; name: string; variables: KVRow[] } {
  const items = data.item || [];
  const collectionPre = eventScripts(data.event, "prerequest");
  const collectionPost = eventScripts(data.event, "test");
  const tree = items.map((item) => parsePostmanItem(item, collectionPre, collectionPost));
  const variables = (data.variable || []).map((item) => ({
    id: uid(), key: item.key, value: String(item.value ?? ""), enabled: !item.disabled, secret: item.type === "secret",
  }));
  return { tree, name: data.info?.name || "Imported Collection", variables };
}

function treeNodeToPostmanItem(node: TreeNode): PostmanItem | null {
  if (node.kind === "folder") {
    const children = node.children.map(treeNodeToPostmanItem).filter((x): x is PostmanItem => x !== null);
    return {
      name: node.name,
      item: children,
    };
  }

  if (node.kind === "grpc") return null;

  const req = node.request;
  const headers: PostmanHeader[] = req.headers
    .filter((h) => h.key.trim())
    .map((h) => ({ key: h.key, value: h.value, ...(h.enabled ? {} : { disabled: true }) }));

  let body: PostmanBody | undefined;
  if (req.bodyMode === "json") {
    body = { mode: "raw", raw: req.bodyText, options: { raw: { language: "json" } } };
  } else if (req.bodyMode === "text") {
    body = { mode: "raw", raw: req.bodyText };
  } else if (req.bodyMode === "form-data") {
    body = {
      mode: "formdata",
      formdata: req.bodyForm
        .filter((f) => f.key.trim())
        .map((f) =>
          f.type === "file"
            ? { key: f.key, type: "file", src: f.value, ...(f.enabled ? {} : { disabled: true }) }
            : { key: f.key, type: "text", value: f.value, ...(f.enabled ? {} : { disabled: true }) }
        ),
    };
  } else if (req.bodyMode === "urlencoded") {
    body = {
      mode: "urlencoded",
      urlencoded: req.bodyUrlencoded
        .filter((f) => f.key.trim())
        .map((f) => ({ key: f.key, value: f.value, ...(f.enabled ? {} : { disabled: true }) })),
    };
  }

  const urlObj: PostmanUrl = { raw: req.url };
  try {
    const parsed = new URL(req.url.replace(/\{\{[^}]*\}\}/g, "placeholder"));
    urlObj.protocol = parsed.protocol.replace(":", "");
    urlObj.host = parsed.hostname.split(".");
    urlObj.path = parsed.pathname.split("/").filter(Boolean);
  } catch {}

  const queryParams = req.params.filter((p) => p.enabled && p.key.trim());
  if (queryParams.length > 0) {
    urlObj.query = queryParams.map((p) => ({
      key: p.key,
      value: p.value,
      ...(p.enabled ? {} : { disabled: true }),
    }));
  }

  return {
    name: node.name,
    event: [
      ...(req.preScript.trim() ? [{ listen: "prerequest", script: { type: "text/javascript", exec: rewriteScriptNamespace(req.preScript, "relay", "pm").split("\n") } }] : []),
      ...(req.testScript.trim() ? [{ listen: "test", script: { type: "text/javascript", exec: rewriteScriptNamespace(req.testScript, "relay", "pm").split("\n") } }] : []),
    ],
    request: {
      method: req.method,
      header: headers.length > 0 ? headers : undefined,
      body,
      url: urlObj,
      ...(req.description.trim() ? { description: req.description } : {}),
      ...(authToPostman(req.auth) ? { auth: authToPostman(req.auth) } : {}),
    },
  };
}

function countGrpcNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.kind === "grpc" ? 1 : n.kind === "folder" ? countGrpcNodes(n.children) : 0), 0);
}

export function treeToPostman(tree: TreeNode[], name: string, variables: KVRow[] = []): { collection: PostmanCollection; skippedGrpcCount: number } {
  const skippedGrpcCount = countGrpcNodes(tree);
  const item = tree.map(treeNodeToPostmanItem).filter((x): x is PostmanItem => x !== null);
  return {
    collection: {
      info: {
        name,
        _postman_id: uid(),
        schema: POSTMAN_SCHEMA,
      },
      item,
      variable: variables.filter((row) => row.key.trim()).map((row) => ({
        key: row.key, value: row.secret ? "" : row.value, ...(row.secret ? { type: "secret" } : {}), ...(!row.enabled ? { disabled: true } : {}),
      })),
    },
    skippedGrpcCount,
  };
}
