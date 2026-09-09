import { Channel, invoke } from "@tauri-apps/api/core";
import { GrpcMethodType } from "../types";

export interface GrpcCatalogMethod {
  name: string;
  methodType: GrpcMethodType;
  template?: string;
}

export interface GrpcCatalogService {
  name: string;
  methods: GrpcCatalogMethod[];
}

interface RawMethodInfo {
  name: string;
  method_type: string;
  template: string;
}

interface RawServiceInfo {
  name: string;
  methods: RawMethodInfo[];
}

export interface ProtoFileInput {
  name: string;
  content: string;
}

export async function listGrpcServices(url: string): Promise<GrpcCatalogService[]> {
  const raw = await invoke<RawServiceInfo[]>("grpc_list_services", { url });
  return raw.map((s) => ({
    name: s.name,
    methods: s.methods.map((m) => ({ name: m.name, methodType: m.method_type as GrpcMethodType, template: m.template })),
  }));
}

export async function listGrpcServicesFromProto(
  files: ProtoFileInput[],
  entryFile: string
): Promise<GrpcCatalogService[]> {
  const raw = await invoke<RawServiceInfo[]>("grpc_list_services_from_proto", { files, entryFile });
  return raw.map((s) => ({
    name: s.name,
    methods: s.methods.map((m) => ({ name: m.name, methodType: m.method_type as GrpcMethodType, template: m.template })),
  }));
}

export function listProtoServiceFiles(files: ProtoFileInput[]): Promise<string[]> {
  return invoke("list_proto_service_files", { files });
}

export interface ProtoFieldSchema {
  name: string;
  kind: "string" | "number" | "bool" | "enum" | "message" | "map";
  typeName: string;
  repeated: boolean;
  required: boolean;
  oneof?: string;
  fields?: ProtoFieldSchema[];
  enumValues?: string[];
  mapValue?: ProtoFieldSchema;
}

export interface GrpcMethodSchema {
  template: string;
  fields: ProtoFieldSchema[];
  inputType: string;
  outputType: string;
  outputFields: ProtoFieldSchema[];
}

export function fetchGrpcMethodSchema(params: {
  url: string;
  service: string;
  method: string;
  protoFiles?: ProtoFileInput[];
  entryFile?: string;
}): Promise<GrpcMethodSchema> {
  return invoke("grpc_method_schema", params);
}

export interface GrpcInvokeResult {
  json: string;
  metadata: [string, string][];
  durationMs: number;
}

export interface GrpcCallPayload {
  url: string;
  service: string;
  method: string;
  messageJson: string;
  metadata: [string, string][];
  timeoutMs: number;
  waitForReady: boolean;
  compression: "none" | "gzip";
  maxResponseSizeBytes: number;
  protoFiles?: ProtoFileInput[];
  entryFile?: string;
}

function nativeGrpcPayload(payload: GrpcCallPayload) {
  return {
    url: payload.url,
    service: payload.service,
    method: payload.method,
    message_json: payload.messageJson,
    metadata: payload.metadata,
    timeout_ms: payload.timeoutMs,
    wait_for_ready: payload.waitForReady,
    compression: payload.compression,
    max_response_size_bytes: payload.maxResponseSizeBytes,
    proto_files: payload.protoFiles,
    entry_file: payload.entryFile,
  };
}

export async function invokeGrpcUnary(payload: GrpcCallPayload): Promise<GrpcInvokeResult> {
  const result = await invoke<{ json: string; metadata: [string, string][]; duration_ms: number }>("grpc_invoke_unary", {
    payload: nativeGrpcPayload(payload),
  });
  return { json: result.json, metadata: result.metadata, durationMs: result.duration_ms };
}

export interface GrpcServerStreamResult extends GrpcInvokeResult {
  sizeBytes: number;
  messageCount: number;
  cancelled: boolean;
}

type RawGrpcStreamEvent =
  | { kind: "metadata"; metadata: [string, string][] }
  | { kind: "message"; json: string };

export async function invokeGrpcServerStream(
  requestId: string,
  payload: GrpcCallPayload,
  onMessage: (json: string) => void,
  onMetadata?: (metadata: [string, string][]) => void
): Promise<GrpcServerStreamResult> {
  const onEvent = new Channel<RawGrpcStreamEvent>((event) => {
    if (event.kind === "message") onMessage(event.json);
    else if (event.kind === "metadata") onMetadata?.(event.metadata);
  });
  const result = await invoke<{
    json: string;
    metadata: [string, string][];
    duration_ms: number;
    size_bytes: number;
    message_count: number;
    cancelled: boolean;
  }>("grpc_invoke_server_stream", {
    requestId,
    payload: nativeGrpcPayload(payload),
    onEvent,
  });
  return {
    json: result.json,
    metadata: result.metadata,
    durationMs: result.duration_ms,
    sizeBytes: result.size_bytes,
    messageCount: result.message_count,
    cancelled: result.cancelled,
  };
}

export function cancelGrpcServerStream(requestId: string): Promise<boolean> {
  return invoke("grpc_cancel_stream", { requestId });
}
