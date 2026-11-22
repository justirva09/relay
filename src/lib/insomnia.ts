import {
  AuthConfig,
  BodyMode,
  FormDataRow,
  KVRow,
  Environment,
  Method,
  RequestNode,
  TreeNode,
  defaultAuth,
  defaultRequestSettings,
  newFormDataRow,
  newRow,
  parsePathParamsFromUrl,
  parseQueryToRows,
  uid,
} from "../types";

interface InsomniaResource {
  _id?: string;
  _type?: string;
  parentId?: string;
  name?: string;
  url?: string;
  method?: string;
  description?: string;
  headers?: any[];
  parameters?: any[];
  body?: any;
  authentication?: any;
  data?: Record<string, unknown>;
}

export function isInsomniaExport(data: any): boolean {
  return (
    (data?._type === "export" && Array.isArray(data?.resources) && data.resources.some((r: any) => r?._type === "workspace")) ||
    (typeof data?.type === "string" && /^(collection|spec)\.insomnia\.rest\/5\.0$/.test(data.type) && Array.isArray(data?.collection))
  );
}

function authFromInsomnia(value: any): AuthConfig {
  if (!value || value.disabled) return defaultAuth();
  if (value.type === "bearer") return { type: "bearer", bearer: { token: value.token || "" } };
  if (value.type === "basic") {
    return { type: "basic", basic: { username: value.username || "", password: value.password || "" } };
  }
  return defaultAuth();
}

function rows(values: any[] | undefined, keyName = "name"): KVRow[] {
  const result = (values || []).map((row) => ({
    id: uid(),
    key: String(row?.[keyName] ?? row?.key ?? ""),
    value: String(row?.value ?? ""),
    enabled: !row?.disabled,
    description: String(row?.description ?? ""),
  }));
  return result.length ? result : [newRow()];
}

function requestFromResource(resource: InsomniaResource): RequestNode {
  const rawUrl = resource.url || "";
  const body = resource.body || {};
  const mime = String(body.mimeType || "").toLowerCase();
  let bodyMode: BodyMode = "none";
  let bodyText = "";
  let bodyForm: FormDataRow[] = [newFormDataRow()];
  let bodyUrlencoded: KVRow[] = [newRow()];

  if (typeof body.text === "string") {
    bodyText = body.text;
    bodyMode = mime.includes("json") ? "json" : "text";
  } else if (Array.isArray(body.params) && mime.includes("multipart")) {
    bodyMode = "form-data";
    bodyForm = body.params.map((item: any) => ({
      id: uid(),
      key: item.name || "",
      value: item.fileName || item.value || "",
      enabled: !item.disabled,
      type: item.type === "file" || item.fileName ? "file" : "text",
      description: item.description || "",
    }));
  } else if (Array.isArray(body.params) && mime.includes("x-www-form-urlencoded")) {
    bodyMode = "urlencoded";
    bodyUrlencoded = rows(body.params);
  }

  const params = rows(resource.parameters);
  if ((!resource.parameters || resource.parameters.length === 0) && rawUrl.includes("?")) {
    params.splice(0, params.length, ...parseQueryToRows(rawUrl));
  }

  return {
    id: uid(),
    kind: "request",
    name: resource.name || `${resource.method || "GET"} request`,
    request: {
      method: (String(resource.method || "GET").toUpperCase() as Method),
      url: rawUrl.split("?")[0] || rawUrl,
      description: resource.description || "",
      params,
      pathParams: parsePathParamsFromUrl(rawUrl),
      headers: rows(resource.headers),
      auth: authFromInsomnia(resource.authentication),
      bodyMode,
      bodyText,
      bodyForm: bodyForm.length ? bodyForm : [newFormDataRow()],
      bodyUrlencoded,
      preScript: "",
      testScript: "",
      examples: [],
      tags: [],
      settings: defaultRequestSettings(),
    },
  };
}

function v5ItemToTree(item: any): TreeNode | null {
  if (Array.isArray(item?.children)) {
    return {
      id: uid(), kind: "folder", name: item.name || "Folder",
      children: item.children.map(v5ItemToTree).filter((node: TreeNode | null): node is TreeNode => node !== null),
    };
  }
  if (!item || typeof item.method !== "string") return null;
  const node = requestFromResource(item);
  const explicitPathParams = Array.isArray(item.pathParameters) ? item.pathParameters : [];
  for (const param of explicitPathParams) {
    const row = node.request.pathParams.find((candidate) => candidate.key === param.name);
    if (row) row.value = String(param.value ?? "");
  }
  node.request.preScript = item.scripts?.preRequest || "";
  node.request.testScript = item.scripts?.afterResponse || "";
  return node;
}

function objectVariables(data: Record<string, unknown> | undefined): KVRow[] {
  return Object.entries(data || {}).map(([key, value]) => ({
    id: uid(), key, value: typeof value === "string" ? value : JSON.stringify(value), enabled: true,
  }));
}

export function insomniaToTree(data: any): { tree: TreeNode[]; name: string; variables: KVRow[]; environments: Environment[] } {
  if (typeof data?.type === "string" && data.type.endsWith(".insomnia.rest/5.0")) {
    const tree = data.collection.map(v5ItemToTree).filter((node: TreeNode | null): node is TreeNode => node !== null);
    const variables = objectVariables(data.environments?.data);
    const environments = (data.environments?.subEnvironments || []).map((environment: any) => ({
      id: uid(), name: environment.name || "Environment", variables: objectVariables(environment.data),
    }));
    return { tree, name: data.name || "Insomnia Collection", variables, environments };
  }
  const resources = data.resources as InsomniaResource[];
  const workspace = resources.find((r) => r._type === "workspace");
  const workspaceId = workspace?._id;
  const groups = resources.filter((r) => r._type === "request_group");
  const requests = resources.filter((r) => r._type === "request");

  const childrenOf = (parentId: string | undefined): TreeNode[] => [
    ...groups
      .filter((g) => g.parentId === parentId)
      .map((g) => ({ id: uid(), kind: "folder" as const, name: g.name || "Folder", children: childrenOf(g._id) })),
    ...requests.filter((r) => r.parentId === parentId).map(requestFromResource),
  ];

  let tree = childrenOf(workspaceId);
  const attachedIds = new Set<string>();
  const markAttached = (parentId: string | undefined) => {
    groups.filter((g) => g.parentId === parentId).forEach((g) => { if (g._id) attachedIds.add(g._id); markAttached(g._id); });
    requests.filter((r) => r.parentId === parentId).forEach((r) => { if (r._id) attachedIds.add(r._id); });
  };
  markAttached(workspaceId);
  const orphans = requests.filter((r) => !r._id || !attachedIds.has(r._id)).map(requestFromResource);
  if (orphans.length) tree = [...tree, ...orphans];

  const environmentResources = resources.filter((r) => r._type === "environment" && r.data);
  const baseEnvironment = environmentResources.find((r) => r.parentId === workspaceId);
  const variables = objectVariables(baseEnvironment?.data);
  const environments = environmentResources.filter((environment) => environment !== baseEnvironment).map((environment) => ({
    id: uid(), name: environment.name || "Environment", variables: objectVariables(environment.data),
  }));
  return { tree, name: workspace?.name || "Insomnia Collection", variables, environments };
}
