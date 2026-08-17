import { TreeNode, FolderNode, RequestNode, KVRow, Method, BodyMode, FormDataRow, defaultRequest, newRow, newFormDataRow, uid, parseQueryToRows, parsePathParamsFromUrl } from "../types";

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

interface PostmanRequest {
  method?: string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  url?: string | PostmanUrl;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
}

interface PostmanCollection {
  info?: { name?: string; schema?: string; _postman_id?: string };
  item?: PostmanItem[];
  variable?: { key: string; value: string }[];
}

export function isPostmanCollection(data: any): data is PostmanCollection {
  return data?.info?.schema?.includes("getpostman.com") || (data?.info && Array.isArray(data?.item));
}

export function isRelayWorkspace(data: any): boolean {
  return Array.isArray(data?.tree);
}

function extractUrl(url: string | PostmanUrl | undefined): string {
  if (!url) return "";
  if (typeof url === "string") return url;
  return url.raw || "";
}

function parsePostmanItem(item: PostmanItem): TreeNode {
  if (item.item && !item.request) {
    const folder: FolderNode = {
      id: uid(),
      kind: "folder",
      name: item.name || "Folder",
      children: item.item.map(parsePostmanItem),
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
      params: parseQueryToRows(rawUrl),
      pathParams: parsePathParamsFromUrl(rawUrl),
      headers,
      bodyMode,
      bodyText,
      bodyForm,
      bodyUrlencoded,
      preScript: "",
      testScript: "",
    },
  };
  return node;
}

export function postmanToTree(data: PostmanCollection): { tree: TreeNode[]; name: string } {
  const items = data.item || [];
  const tree = items.map(parsePostmanItem);
  return { tree, name: data.info?.name || "Imported Collection" };
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
    request: {
      method: req.method,
      header: headers.length > 0 ? headers : undefined,
      body,
      url: urlObj,
    },
  };
}

function countGrpcNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.kind === "grpc" ? 1 : n.kind === "folder" ? countGrpcNodes(n.children) : 0), 0);
}

export function treeToPostman(tree: TreeNode[], name: string): { collection: PostmanCollection; skippedGrpcCount: number } {
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
    },
    skippedGrpcCount,
  };
}
