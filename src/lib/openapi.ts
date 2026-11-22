import * as yaml from "js-yaml";
import {
  TreeNode,
  FolderNode,
  RequestNode,
  KVRow,
  Method,
  FormDataRow,
  AuthConfig,
  defaultAuth,
  defaultRequest,
  newRow,
  newFormDataRow,
  uid,
  parsePathParamsFromUrl,
} from "../types";

const HTTP_METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function isOpenApiSpec(data: any): boolean {
  return typeof data?.openapi === "string" && data.openapi.startsWith("3.");
}

// OpenAPI specs are often YAML, valid JSON is valid YAML too, so try JSON first then fall back
export function parseCollectionFile(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return yaml.load(raw);
  }
}

function resolveSchema(schema: any, spec: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (typeof schema.$ref === "string") {
    const path = schema.$ref.replace(/^#\//, "").split("/");
    let node = spec;
    for (const seg of path) node = node?.[seg];
    return node && typeof node === "object" ? node : {};
  }
  return schema;
}

function exampleFromSchema(schemaIn: any, spec: any, seen: Set<string> = new Set()): any {
  if (!schemaIn) return null;
  if (typeof schemaIn.$ref === "string") {
    if (seen.has(schemaIn.$ref)) return {};
    seen = new Set(seen);
    seen.add(schemaIn.$ref);
  }
  const schema = resolveSchema(schemaIn, spec);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  switch (schema.type) {
    case "object":
      return objectExample(schema, spec, seen);
    case "array": {
      const item = schema.items ? exampleFromSchema(schema.items, spec, seen) : null;
      return item !== null ? [item] : [];
    }
    case "string":
      if (schema.format === "date-time") return new Date().toISOString();
      if (schema.format === "date") return new Date().toISOString().slice(0, 10);
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return schema.properties ? objectExample(schema, spec, seen) : null;
  }
}

function objectExample(schema: any, spec: any, seen: Set<string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, propSchema] of Object.entries(schema.properties || {})) {
    out[key] = exampleFromSchema(propSchema, spec, seen);
  }
  return out;
}

function paramDefaultValue(param: any, spec: any): string {
  const schema = param.schema ? resolveSchema(param.schema, spec) : undefined;
  const raw = param.example ?? schema?.example ?? schema?.default;
  if (raw === undefined) return "";
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

// OpenAPI uses "/users/{id}" for path params; Relay uses Postman-style "/users/:id".
function convertPathTemplate(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

function firstPathSegment(path: string): string {
  const seg = path.split("/").find((s) => s && !s.startsWith("{"));
  return seg || "root";
}

interface AuthResult {
  header?: [string, string];
  variables?: KVRow[];
  auth?: AuthConfig;
}

function resolveGlobalAuth(spec: any): AuthResult {
  const globalSecurity = spec.security;
  const schemes = spec.components?.securitySchemes || {};
  if (!Array.isArray(globalSecurity) || globalSecurity.length === 0) return {};
  const schemeName = Object.keys(globalSecurity[0] || {})[0];
  const scheme = schemes[schemeName];
  if (!scheme) return {};

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return {
      auth: { type: "bearer", bearer: { token: "{{token}}" } },
      variables: [{ id: uid(), key: "token", value: "", enabled: true }],
    };
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return {
      auth: { type: "basic", basic: { username: "{{basicUser}}", password: "{{basicPass}}" } },
      variables: [
        { id: uid(), key: "basicUser", value: "", enabled: true },
        { id: uid(), key: "basicPass", value: "", enabled: true },
      ],
    };
  }
  if (scheme.type === "apiKey" && scheme.in === "header") {
    const varName = (scheme.name || "apiKey").replace(/[^a-zA-Z0-9_]/g, "") || "apiKey";
    return { header: [scheme.name, `{{${varName}}}`], variables: [{ id: uid(), key: varName, value: "", enabled: true }] };
  }
  return {};
}

function requestBodyFor(operation: any, spec: any): Pick<RequestNode["request"], "bodyMode" | "bodyText" | "bodyForm" | "bodyUrlencoded"> {
  const content = operation.requestBody?.content;
  const base = { bodyMode: "none" as const, bodyText: "", bodyForm: [newFormDataRow()], bodyUrlencoded: [newRow()] };
  if (!content) return base;

  if (content["application/json"]) {
    const schema = content["application/json"].schema;
    const example = content["application/json"].example ?? (schema ? exampleFromSchema(schema, spec) : undefined);
    return { ...base, bodyMode: "json", bodyText: example !== undefined ? JSON.stringify(example, null, 2) : "" };
  }

  const multipart = content["multipart/form-data"];
  if (multipart?.schema) {
    const schema = resolveSchema(multipart.schema, spec);
    const rows: FormDataRow[] = Object.entries(schema.properties || {}).map(([key, propSchemaIn]) => {
      const propSchema = resolveSchema(propSchemaIn, spec);
      const isFile = propSchema.type === "string" && propSchema.format === "binary";
      return { id: uid(), key, value: "", enabled: true, type: isFile ? "file" : "text" };
    });
    return { ...base, bodyMode: "form-data", bodyForm: rows.length ? rows : [newFormDataRow()] };
  }

  const urlencoded = content["application/x-www-form-urlencoded"];
  if (urlencoded?.schema) {
    const schema = resolveSchema(urlencoded.schema, spec);
    const rows: KVRow[] = Object.entries(schema.properties || {}).map(([key, propSchemaIn]) => {
      const value = exampleFromSchema(propSchemaIn, spec);
      return { id: uid(), key, value: value !== null && value !== undefined ? String(value) : "", enabled: true };
    });
    return { ...base, bodyMode: "urlencoded", bodyUrlencoded: rows.length ? rows : [newRow()] };
  }

  return base;
}

export function parseOpenApiSpec(spec: any): { tree: TreeNode[]; name: string; variables: KVRow[] } {
  const primaryServer = spec.servers?.[0];
  const baseUrl = (primaryServer?.url || "").replace(/\{([^}]+)\}/g, "{{$1}}").replace(/\/$/, "");
  const auth = resolveGlobalAuth(spec);
  const groups = new Map<string, RequestNode[]>();

  for (const [rawPath, pathItem] of Object.entries<any>(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method.toLowerCase()];
      if (!operation) continue;

      const opParams = Array.isArray(operation.parameters) ? operation.parameters : [];
      const paramsByKey = new Map<string, any>();
      for (const p of [...pathLevelParams, ...opParams]) paramsByKey.set(`${p.in}:${p.name}`, p);
      const allParams = Array.from(paramsByKey.values());

      const convertedPath = convertPathTemplate(rawPath);
      const fullUrl = baseUrl + (convertedPath.startsWith("/") ? convertedPath : `/${convertedPath}`);

      const queryRows: KVRow[] = allParams
        .filter((p) => p.in === "query")
        .map((p) => ({ id: uid(), key: p.name, value: paramDefaultValue(p, spec), enabled: true, description: p.description || "" }));
      const headerRows: KVRow[] = allParams
        .filter((p) => p.in === "header")
        .map((p) => ({ id: uid(), key: p.name, value: paramDefaultValue(p, spec), enabled: true, description: p.description || "" }));
      if (auth.header) headerRows.push({ id: uid(), key: auth.header[0], value: auth.header[1], enabled: true });
      if (headerRows.length === 0) headerRows.push(newRow());

      const pathParamRows = parsePathParamsFromUrl(convertedPath);
      for (const p of allParams.filter((p) => p.in === "path")) {
        const row = pathParamRows.find((r) => r.key === p.name);
        if (row) {
          row.value = paramDefaultValue(p, spec);
          row.description = p.description || "";
        }
      }

      const body = requestBodyFor(operation, spec);
      const name: string = operation.summary || operation.operationId || `${method} ${rawPath}`;
      const groupName: string = operation.tags?.[0] || firstPathSegment(rawPath);

      const paramDocs = allParams
        .filter((p) => p.description)
        .map((p) => `- \`${p.name}\` (${p.in}): ${p.description}`)
        .join("\n");
      const description = [operation.description, paramDocs ? `**Parameters:**\n${paramDocs}` : ""]
        .filter(Boolean)
        .join("\n\n");

      const request: RequestNode["request"] = {
        ...defaultRequest(method, fullUrl),
        description,
        params: queryRows.length ? queryRows : [newRow()],
        pathParams: pathParamRows,
        headers: headerRows,
        auth: auth.auth ?? defaultAuth(),
        ...body,
      };

      const node: RequestNode = { id: uid(), kind: "request", name, request };
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push(node);
    }
  }

  const tree: TreeNode[] = Array.from(groups.entries()).map(([groupName, children]): FolderNode => ({
    id: uid(),
    kind: "folder",
    name: groupName,
    children,
  }));

  const serverVariables: KVRow[] = Object.entries<any>(primaryServer?.variables || {}).map(([key, config]) => ({
    id: uid(), key, value: String(config?.default ?? ""), enabled: true, description: config?.description || "",
  }));
  const variables = [...serverVariables];
  for (const variable of auth.variables ?? []) {
    if (!variables.some((existing) => existing.key.toLowerCase() === variable.key.toLowerCase())) variables.push(variable);
  }
  return { tree, name: spec.info?.title || "Imported API", variables };
}

function inferSchema(value: any): any {
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) return { type: "array", items: value.length ? inferSchema(value[0]) : {} };
  if (typeof value === "object") {
    return { type: "object", properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inferSchema(item)])) };
  }
  if (typeof value === "boolean") return { type: "boolean", example: value };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number", example: value };
  return { type: "string", ...(value === "" ? {} : { example: String(value) }) };
}

function schemaFromText(text: string): { schema: any; example?: any } {
  try {
    const parsed = JSON.parse(text);
    return { schema: inferSchema(parsed), example: parsed };
  } catch {
    return { schema: { type: "string" }, ...(text ? { example: text } : {}) };
  }
}

function relayUrlParts(rawUrl: string): { server?: string; path: string } {
  const withoutQuery = rawUrl.split("?")[0];
  const absolute = /^(https?:\/\/[^/]+)(\/.*)?$/i.exec(withoutQuery);
  if (absolute) return { server: absolute[1].replace(/\{\{([^}]+)\}\}/g, "{$1}"), path: absolute[2] || "/" };
  const variableServer = /^(\{\{[^}]+\}\})(\/.*)?$/.exec(withoutQuery);
  if (variableServer) return { server: variableServer[1].replace(/^\{\{([^}]+)\}\}$/, "{$1}"), path: variableServer[2] || "/" };
  return { path: withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}` };
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]\w*)/g, "{$1}");
}

function parameterSchema(value: string): any {
  if (/^-?\d+$/.test(value)) return { type: "integer", ...(value ? { example: Number(value) } : {}) };
  if (/^-?\d+\.\d+$/.test(value)) return { type: "number", ...(value ? { example: Number(value) } : {}) };
  if (value === "true" || value === "false") return { type: "boolean", example: value === "true" };
  return { type: "string", ...(value ? { example: value } : {}) };
}

function requestBodyToOpenApi(req: RequestNode["request"]): any | undefined {
  if (req.bodyMode === "json") {
    const parsed = schemaFromText(req.bodyText);
    return { content: { "application/json": { schema: parsed.schema, ...(parsed.example !== undefined ? { example: parsed.example } : {}) } } };
  }
  if (req.bodyMode === "text") {
    return { content: { "text/plain": { schema: { type: "string" }, ...(req.bodyText ? { example: req.bodyText } : {}) } } };
  }
  const rows = req.bodyMode === "form-data" ? req.bodyForm : req.bodyMode === "urlencoded" ? req.bodyUrlencoded : null;
  if (!rows) return undefined;
  const properties = Object.fromEntries(rows.filter((row) => row.enabled && row.key.trim()).map((row) => {
    const isFile = req.bodyMode === "form-data" && "type" in row && row.type === "file";
    return [row.key, isFile ? { type: "string", format: "binary" } : parameterSchema(row.value)];
  }));
  const mediaType = req.bodyMode === "form-data" ? "multipart/form-data" : "application/x-www-form-urlencoded";
  return { content: { [mediaType]: { schema: { type: "object", properties } } } };
}

function responsesToOpenApi(req: RequestNode["request"]): Record<string, any> {
  if (!req.examples.length) return { "200": { description: "Successful response" } };
  const responses: Record<string, any> = {};
  for (const example of req.examples) {
    const status = String(example.status || 200);
    const contentType = example.headers.find(([key]) => key.toLowerCase() === "content-type")?.[1]?.split(";")[0] || "application/json";
    const parsed = schemaFromText(example.body);
    const response = responses[status] ?? { description: example.name || "Response", content: {} };
    const media = response.content[contentType] ?? { schema: parsed.schema, examples: {} };
    media.examples[example.scenarioKey || example.id] = { summary: example.name, value: parsed.example ?? example.body };
    response.content[contentType] = media;
    responses[status] = response;
  }
  return responses;
}

function serverObject(url: string, variables: KVRow[]): any {
  const names = [...url.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (!names.length) return { url };
  return {
    url,
    variables: Object.fromEntries(names.map((name) => {
      const variable = variables.find((row) => row.key === name);
      return [name, { default: variable ? (variable.secret ? "" : variable.value) : "localhost" }];
    })),
  };
}

export function treeToOpenApi(
  tree: TreeNode[],
  name: string,
  variables: KVRow[] = []
): { document: any; skippedGrpcCount: number } {
  const paths: Record<string, any> = {};
  const tagNames = new Set<string>();
  const securitySchemes: Record<string, any> = {};
  let skippedGrpcCount = 0;

  const visit = (nodes: TreeNode[], folders: string[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") { visit(node.children, [...folders, node.name]); continue; }
      if (node.kind === "grpc") { skippedGrpcCount++; continue; }
      const req = node.request;
      const { server, path: rawPath } = relayUrlParts(req.url);
      const path = openApiPath(rawPath || "/");
      const tag = folders.join(" / ");
      if (tag) tagNames.add(tag);
      const parameters: any[] = [];
      for (const row of req.pathParams.filter((item) => item.key.trim())) {
        parameters.push({ name: row.key, in: "path", required: true, ...(row.description ? { description: row.description } : {}), schema: parameterSchema(row.value) });
      }
      for (const row of req.params.filter((item) => item.key.trim())) {
        parameters.push({ name: row.key, in: "query", required: false, ...(row.description ? { description: row.description } : {}), schema: parameterSchema(row.value), ...(row.enabled ? {} : { "x-relay-disabled": true }) });
      }
      for (const row of req.headers.filter((item) => item.key.trim())) {
        parameters.push({ name: row.key, in: "header", required: false, ...(row.description ? { description: row.description } : {}), schema: parameterSchema(row.value), ...(row.enabled ? {} : { "x-relay-disabled": true }) });
      }
      let security: any[] | undefined;
      if (req.auth.type === "bearer") {
        securitySchemes.BearerAuth = { type: "http", scheme: "bearer" }; security = [{ BearerAuth: [] }];
      } else if (req.auth.type === "basic") {
        securitySchemes.BasicAuth = { type: "http", scheme: "basic" }; security = [{ BasicAuth: [] }];
      }
      const operation: any = {
        summary: node.name,
        operationId: node.id.replace(/[^A-Za-z0-9_]/g, "_"),
        ...(req.description ? { description: req.description } : {}),
        ...(tag ? { tags: [tag] } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(requestBodyToOpenApi(req) ? { requestBody: requestBodyToOpenApi(req) } : {}),
        responses: responsesToOpenApi(req),
        ...(server ? { servers: [serverObject(server, variables)] } : {}),
        ...(security ? { security } : {}),
      };
      const method = req.method.toLowerCase();
      paths[path] ??= {};
      if (paths[path][method]) {
        const duplicates = paths[path][method]["x-relay-duplicates"] ?? [];
        paths[path][method]["x-relay-duplicates"] = [...duplicates, operation];
      } else {
        paths[path][method] = operation;
      }
    }
  };
  visit(tree, []);
  const document: any = {
    openapi: "3.0.3",
    info: { title: name, version: "1.0.0" },
    paths,
    ...(tagNames.size ? { tags: [...tagNames].map((tag) => ({ name: tag })) } : {}),
    ...(Object.keys(securitySchemes).length ? { components: { securitySchemes } } : {}),
  };
  return { document, skippedGrpcCount };
}
