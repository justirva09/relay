import * as yaml from "js-yaml";
import {
  TreeNode,
  FolderNode,
  RequestNode,
  KVRow,
  Method,
  FormDataRow,
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

// Postman/Relay files are JSON; OpenAPI specs are often YAML. Valid JSON is
// valid YAML, so trying JSON first (exact + fast) then falling back to a
// YAML parse covers both without needing to sniff the file extension.
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
  variable?: KVRow;
}

function resolveGlobalAuth(spec: any): AuthResult {
  const globalSecurity = spec.security;
  const schemes = spec.components?.securitySchemes || {};
  if (!Array.isArray(globalSecurity) || globalSecurity.length === 0) return {};
  const schemeName = Object.keys(globalSecurity[0] || {})[0];
  const scheme = schemes[schemeName];
  if (!scheme) return {};

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return { header: ["Authorization", "Bearer {{token}}"], variable: { id: uid(), key: "token", value: "", enabled: true } };
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return { header: ["Authorization", "Basic {{basicAuth}}"], variable: { id: uid(), key: "basicAuth", value: "", enabled: true } };
  }
  if (scheme.type === "apiKey" && scheme.in === "header") {
    const varName = (scheme.name || "apiKey").replace(/[^a-zA-Z0-9_]/g, "") || "apiKey";
    return { header: [scheme.name, `{{${varName}}}`], variable: { id: uid(), key: varName, value: "", enabled: true } };
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
  const baseUrl = (spec.servers?.[0]?.url || "").replace(/\/$/, "");
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
        .map((p) => ({ id: uid(), key: p.name, value: paramDefaultValue(p, spec), enabled: true }));
      const headerRows: KVRow[] = allParams
        .filter((p) => p.in === "header")
        .map((p) => ({ id: uid(), key: p.name, value: paramDefaultValue(p, spec), enabled: true }));
      if (auth.header) headerRows.push({ id: uid(), key: auth.header[0], value: auth.header[1], enabled: true });
      if (headerRows.length === 0) headerRows.push(newRow());

      const pathParamRows = parsePathParamsFromUrl(convertedPath);
      for (const p of allParams.filter((p) => p.in === "path")) {
        const row = pathParamRows.find((r) => r.key === p.name);
        if (row) row.value = paramDefaultValue(p, spec);
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

  const variables: KVRow[] = auth.variable ? [auth.variable] : [];
  return { tree, name: spec.info?.title || "Imported API", variables };
}
