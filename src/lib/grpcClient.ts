import { invoke } from "@tauri-apps/api/core";
import { GrpcMethodType } from "../types";

export interface GrpcCatalogMethod {
  name: string;
  methodType: GrpcMethodType;
}

export interface GrpcCatalogService {
  name: string;
  methods: GrpcCatalogMethod[];
}

interface RawMethodInfo {
  name: string;
  method_type: string;
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
    methods: s.methods.map((m) => ({ name: m.name, methodType: m.method_type as GrpcMethodType })),
  }));
}

export async function listGrpcServicesFromProto(
  files: ProtoFileInput[],
  entryFile: string
): Promise<GrpcCatalogService[]> {
  const raw = await invoke<RawServiceInfo[]>("grpc_list_services_from_proto", { files, entryFile });
  return raw.map((s) => ({
    name: s.name,
    methods: s.methods.map((m) => ({ name: m.name, methodType: m.method_type as GrpcMethodType })),
  }));
}

export function listProtoServiceFiles(files: ProtoFileInput[]): Promise<string[]> {
  return invoke("list_proto_service_files", { files });
}

export interface GrpcInvokeResult {
  json: string;
  metadata: [string, string][];
  durationMs: number;
}

export async function invokeGrpcUnary(payload: {
  url: string;
  service: string;
  method: string;
  messageJson: string;
  metadata: [string, string][];
  protoFiles?: ProtoFileInput[];
  entryFile?: string;
}): Promise<GrpcInvokeResult> {
  const result = await invoke<{ json: string; metadata: [string, string][]; duration_ms: number }>("grpc_invoke_unary", {
    payload: {
      url: payload.url,
      service: payload.service,
      method: payload.method,
      message_json: payload.messageJson,
      metadata: payload.metadata,
      proto_files: payload.protoFiles,
      entry_file: payload.entryFile,
    },
  });
  return { json: result.json, metadata: result.metadata, durationMs: result.duration_ms };
}
