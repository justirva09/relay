import {
  AuthConfig,
  BodyMode,
  FormDataRow,
  Environment,
  KVRow,
  Method,
  RequestNode,
  TreeNode,
  defaultAuth,
  defaultRequestSettings,
  newFormDataRow,
  newRow,
  parsePathParamsFromUrl,
  uid,
} from "../types";
import * as yaml from "js-yaml";

export interface BrunoFile { name: string; content: string }

function block(source: string, blockName: string): string | null {
  const match = new RegExp(`(?:^|\\n)\\s*${blockName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\{`, "m").exec(source);
  if (!match) return null;
  const start = source.indexOf("{", match.index) + 1;
  let depth = 1;
  let quote = "";
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (escaped) { escaped = false; continue; }
    if (quote && char === "\\") { escaped = true; continue; }
    if (char === '"' || char === "'") { quote = quote === char ? "" : quote || char; continue; }
    if (quote) continue;
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(start, i).trim();
  }
  return null;
}

function pairs(content: string | null): KVRow[] {
  if (!content) return [];
  return content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("//") && !line.startsWith("@"))
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon < 0) return null;
      let key = line.slice(0, colon).trim();
      const enabled = !key.startsWith("~");
      if (!enabled) key = key.slice(1);
      return { id: uid(), key, value: line.slice(colon + 1).trim(), enabled } as KVRow;
    }).filter((row): row is KVRow => row !== null);
}

function value(content: string | null, key: string): string {
  return pairs(content).find((row) => row.key === key)?.value || "";
}

function authFromBru(source: string, type: string): AuthConfig {
  if (type === "bearer") return { type: "bearer", bearer: { token: value(block(source, "auth:bearer"), "token") } };
  if (type === "basic") {
    const content = block(source, "auth:basic");
    return { type: "basic", basic: { username: value(content, "username"), password: value(content, "password") } };
  }
  return defaultAuth();
}

function parseRequest(file: BrunoFile): RequestNode | null {
  const meta = block(file.content, "meta");
  const type = value(meta, "type");
  if (type && type !== "http") return null;
  const methods = ["get", "post", "put", "patch", "delete", "head", "options"];
  const methodName = methods.find((method) => block(file.content, method) !== null);
  if (!methodName) return null;
  const requestBlock = block(file.content, methodName)!;
  const rawUrl = value(requestBlock, "url");
  const bodyKind = value(requestBlock, "body");
  const authKind = value(requestBlock, "auth");
  let bodyMode: BodyMode = "none";
  let bodyText = "";
  let bodyForm: FormDataRow[] = [newFormDataRow()];
  let bodyUrlencoded: KVRow[] = [newRow()];
  if (bodyKind === "json" || block(file.content, "body:json") !== null) {
    bodyMode = "json"; bodyText = block(file.content, "body:json") || "";
  } else if (["text", "xml"].includes(bodyKind) || block(file.content, "body:text") !== null) {
    bodyMode = "text"; bodyText = block(file.content, `body:${bodyKind || "text"}`) || "";
  } else if (bodyKind === "form-urlencoded" || block(file.content, "body:form-urlencoded") !== null) {
    bodyMode = "urlencoded"; bodyUrlencoded = pairs(block(file.content, "body:form-urlencoded"));
  } else if (bodyKind === "multipart-form" || block(file.content, "body:multipart-form") !== null) {
    bodyMode = "form-data";
    bodyForm = pairs(block(file.content, "body:multipart-form")).map((row) => ({ ...row, type: row.value.startsWith("@file(") ? "file" : "text", value: row.value.replace(/^@file\((.*)\)$/, "$1") }));
  }
  const query = pairs(block(file.content, "query"));
  const headers = pairs(block(file.content, "headers"));
  const fileStem = file.name.split("/").pop()?.replace(/\.bru$/i, "") || "Request";
  return {
    id: uid(), kind: "request", name: value(meta, "name") || fileStem,
    request: {
      method: methodName.toUpperCase() as Method, url: rawUrl, description: block(file.content, "docs") || "",
      params: query.length ? query : [newRow()], pathParams: parsePathParamsFromUrl(rawUrl),
      headers: headers.length ? headers : [newRow()], auth: authFromBru(file.content, authKind),
      bodyMode, bodyText, bodyForm: bodyForm.length ? bodyForm : [newFormDataRow()],
      bodyUrlencoded: bodyUrlencoded.length ? bodyUrlencoded : [newRow()], preScript: block(file.content, "script:pre-request") || "",
      testScript: block(file.content, "tests") || "", examples: [], tags: [], settings: defaultRequestSettings(),
    },
  };
}

function rowsFromOpenCollection(values: any[] | undefined, type?: string): KVRow[] {
  return (values || []).filter((item) => !type || item?.type === type).map((item) => ({
    id: uid(), key: String(item?.name ?? item?.key ?? ""), value: String(item?.value ?? ""),
    enabled: !item?.disabled, description: String(item?.description ?? ""), secret: Boolean(item?.secret),
  }));
}

function authFromOpenCollection(value: any): AuthConfig {
  if (!value || typeof value === "string" || value.type === "none" || value.type === "inherit") return defaultAuth();
  if (value.type === "bearer") return { type: "bearer", bearer: { token: value.token ?? value.bearer?.token ?? "" } };
  if (value.type === "basic") return { type: "basic", basic: { username: value.username ?? value.basic?.username ?? "", password: value.password ?? value.basic?.password ?? "" } };
  return defaultAuth();
}

function requestFromOpenCollection(data: any, fileName: string): RequestNode | null {
  if (data?.info?.type !== "http" || !data.http) return null;
  const http = data.http;
  const rawUrl = String(http.url || "");
  const allParams = Array.isArray(http.params) ? http.params : [];
  const headers = [...rowsFromOpenCollection(http.headers), ...rowsFromOpenCollection(allParams, "header")];
  const query = rowsFromOpenCollection(allParams, "query");
  const explicitPath = rowsFromOpenCollection(allParams, "path");
  const body = http.body || {};
  let bodyMode: BodyMode = "none";
  let bodyText = "";
  let bodyForm: FormDataRow[] = [newFormDataRow()];
  let bodyUrlencoded: KVRow[] = [newRow()];
  if (body.type === "json" || body.type === "text" || body.type === "xml") {
    bodyMode = body.type === "json" ? "json" : "text";
    bodyText = typeof body.data === "string" ? body.data : JSON.stringify(body.data ?? "", null, 2);
  } else if (body.type === "form-urlencoded") {
    bodyMode = "urlencoded"; bodyUrlencoded = rowsFromOpenCollection(body.data || body.params);
  } else if (body.type === "multipart-form") {
    bodyMode = "form-data";
    bodyForm = (body.data || body.params || []).map((item: any) => ({
      id: uid(), key: item.name || item.key || "", value: item.value || item.file || "", enabled: !item.disabled,
      description: item.description || "", type: item.type === "file" || item.file ? "file" : "text",
    }));
  }
  const scripts = Array.isArray(data.runtime?.scripts) ? data.runtime.scripts : [];
  const pathParams = parsePathParamsFromUrl(rawUrl);
  for (const item of explicitPath) {
    const row = pathParams.find((candidate) => candidate.key === item.key);
    if (row) Object.assign(row, item);
  }
  return {
    id: uid(), kind: "request", name: data.info.name || fileName.replace(/\.ya?ml$/i, ""),
    request: {
      method: String(http.method || "GET").toUpperCase() as Method, url: rawUrl,
      description: data.docs?.content || "", params: query.length ? query : [newRow()], pathParams,
      headers: headers.length ? headers : [newRow()], auth: authFromOpenCollection(http.auth),
      bodyMode, bodyText, bodyForm: bodyForm.length ? bodyForm : [newFormDataRow()],
      bodyUrlencoded: bodyUrlencoded.length ? bodyUrlencoded : [newRow()],
      preScript: scripts.find((item: any) => item.type === "before-request")?.code || "",
      testScript: scripts.find((item: any) => item.type === "tests" || item.type === "after-response")?.code || "",
      examples: [], tags: [], settings: defaultRequestSettings(),
    },
  };
}

export function brunoFilesToTree(files: BrunoFile[]): { tree: TreeNode[]; name: string; variables: KVRow[]; environments: Environment[] } {
  const marker = files.find((file) => file.name.toLowerCase() === "bruno.json");
  let name = "Bruno Collection";
  if (marker) { try { name = JSON.parse(marker.content).name || name; } catch {} }
  const openCollectionMarker = files.find((file) => /^opencollection\.ya?ml$/i.test(file.name));
  let openCollection: any = null;
  if (openCollectionMarker) {
    openCollection = yaml.load(openCollectionMarker.content);
    name = openCollection?.info?.name || name;
  }
  const root: TreeNode[] = [];
  const folders = new Map<string, TreeNode[]>();
  folders.set("", root);
  const ensureFolder = (path: string): TreeNode[] => {
    if (folders.has(path)) return folders.get(path)!;
    const parts = path.split("/");
    const folderName = parts.pop()!;
    const parentPath = parts.join("/");
    const children: TreeNode[] = [];
    ensureFolder(parentPath).push({ id: uid(), kind: "folder", name: folderName, children });
    folders.set(path, children);
    return children;
  };
  const bruRequests = files.filter((item) => item.name.toLowerCase().endsWith(".bru")).sort((left, right) => {
    const leftSeq = Number(value(block(left.content, "meta"), "seq")) || Number.MAX_SAFE_INTEGER;
    const rightSeq = Number(value(block(right.content, "meta"), "seq")) || Number.MAX_SAFE_INTEGER;
    return leftSeq - rightSeq || left.name.localeCompare(right.name);
  });
  for (const file of bruRequests) {
    if (/^(collection|folder)\.bru$/i.test(file.name.split("/").pop() || "") || file.name.toLowerCase().startsWith("environments/")) continue;
    const request = parseRequest(file);
    if (!request) continue;
    const folderPath = file.name.split("/").slice(0, -1).join("/");
    ensureFolder(folderPath).push(request);
  }
  const yamlRequests = files.filter((item) => /\.ya?ml$/i.test(item.name)).map((file) => {
    try { return { file, data: yaml.load(file.content) as any }; } catch { return { file, data: null }; }
  }).sort((left, right) => (Number(left.data?.info?.seq) || Number.MAX_SAFE_INTEGER) - (Number(right.data?.info?.seq) || Number.MAX_SAFE_INTEGER) || left.file.name.localeCompare(right.file.name));
  for (const { file, data } of yamlRequests) {
    if (/^(opencollection|folder)\.ya?ml$/i.test(file.name.split("/").pop() || "") || file.name.toLowerCase().startsWith("environments/")) continue;
    let request: RequestNode | null = null;
    try { request = requestFromOpenCollection(data, file.name.split("/").pop() || "Request"); } catch {}
    if (!request) continue;
    ensureFolder(file.name.split("/").slice(0, -1).join("/")).push(request);
  }
  for (const item of openCollection?.items || []) {
    const request = requestFromOpenCollection(item, item?.info?.name || "Request");
    if (request) root.push(request);
  }
  const collectionFile = files.find((file) => file.name.toLowerCase() === "collection.bru");
  const variables = collectionFile
    ? pairs(block(collectionFile.content, "vars"))
    : rowsFromOpenCollection(openCollection?.request?.variables);
  const environments = files.filter((file) => /^environments\/.+\.(bru|ya?ml)$/i.test(file.name)).map((file): Environment | null => {
    const fileName = file.name.split("/").pop() || "Environment";
    if (/\.bru$/i.test(fileName)) {
      const meta = block(file.content, "meta");
      const envVariables = pairs(block(file.content, "vars"));
      return { id: uid(), name: value(meta, "name") || fileName.replace(/\.bru$/i, ""), variables: envVariables };
    }
    try {
      const data: any = yaml.load(file.content);
      return { id: uid(), name: data?.name || data?.info?.name || fileName.replace(/\.ya?ml$/i, ""), variables: rowsFromOpenCollection(data?.variables) };
    } catch { return null; }
  }).filter((environment): environment is Environment => environment !== null);
  if (!root.length) throw new Error("No HTTP requests were found in this Bruno collection.");
  return { tree: root, name, variables, environments };
}
