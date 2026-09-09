import React, { useEffect, useState } from "react";
import { fetchGrpcMethodSchema, GrpcMethodSchema, ProtoFieldSchema } from "../../lib/grpcClient";
import { substituteVars, workspaceVariableValues } from "../../lib/pm";
import { useWorkspace } from "../../store";
import { GrpcMethodType, GrpcRequestData } from "../../types";

const METHOD_TYPE_LABEL: Record<GrpcMethodType, string> = {
  unary: "Unary",
  "server-stream": "Server streaming",
  "client-stream": "Client streaming",
  bidi: "Bidirectional streaming",
};

function shortType(typeName: string): string {
  return typeName.split(".").pop() || typeName;
}

function fieldType(field: ProtoFieldSchema): string {
  if (field.kind === "map") return `map<key, ${field.mapValue ? shortType(field.mapValue.typeName) : "value"}>`;
  return shortType(field.typeName);
}

function FieldTree({ fields, depth = 0 }: { fields: ProtoFieldSchema[]; depth?: number }) {
  if (fields.length === 0) return <p className="px-2 py-1.5 font-mono text-[11px] text-th-text-4">empty message</p>;
  return (
    <div className={depth ? "ml-4 border-l border-th-border pl-2" : ""}>
      {fields.map((field) => {
        const children = field.fields ?? [];
        const expandable = children.length > 0 || !!field.enumValues?.length;
        const row = (
          <div className="flex min-w-0 items-baseline gap-2 py-1.5 font-mono text-[11.5px]">
            <span className="truncate text-th-text-1">{field.name}</span>
            <span className="ml-auto shrink-0 text-sky-400">{fieldType(field)}</span>
            {field.required && <span className="rounded bg-rose-500/10 px-1 text-[9.5px] text-rose-300">required</span>}
            {field.repeated && <span className="rounded bg-th-bg px-1 text-[9.5px] text-th-text-4">repeated</span>}
            {field.oneof && <span className="rounded bg-th-bg px-1 text-[9.5px] text-th-text-4">oneof {field.oneof}</span>}
          </div>
        );
        if (!expandable) return <div key={field.name} className="px-1">{row}</div>;
        return (
          <details key={field.name} className="group" open={depth === 0}>
            <summary className="cursor-pointer list-none rounded px-1 hover:bg-th-hover">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-th-text-4 transition-transform group-open:rotate-90">›</span>
                <div className="min-w-0 flex-1">{row}</div>
              </div>
            </summary>
            {children.length > 0 ? (
              <FieldTree fields={children} depth={depth + 1} />
            ) : (
              <div className="ml-5 flex flex-wrap gap-1 pb-2">
                {field.enumValues?.map((value) => (
                  <span key={value} className="rounded bg-th-bg px-1.5 py-0.5 font-mono text-[10px] text-th-text-3">{value}</span>
                ))}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

function MessageSchema({ label, typeName, fields, open }: { label: string; typeName: string; fields: ProtoFieldSchema[]; open?: boolean }) {
  return (
    <details open={open} className="rounded-md border border-th-border bg-th-surface">
      <summary className="cursor-pointer list-none px-3 py-2.5 hover:bg-th-hover">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-th-text-4">{label}</span>
          <span className="truncate font-mono text-[12px] text-th-text-1" title={typeName}>{typeName}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-th-text-4">{fields.length} fields</span>
        </div>
      </summary>
      <div className="max-h-[260px] overflow-auto border-t border-th-border px-3 py-1">
        <FieldTree fields={fields} />
      </div>
    </details>
  );
}

export default function GrpcMethodInfoModal({ request, onClose }: { request: GrpcRequestData; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const [schema, setSchema] = useState<GrpcMethodSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const variables = workspaceVariableValues(workspace);
    const url = substituteVars(request.url, variables) ?? request.url;
    const fromProto = request.protoSource === "imported" && !!request.activeProtoFile;
    setSchema(null);
    setError(null);
    fetchGrpcMethodSchema({
      url,
      service: request.service,
      method: request.method,
      protoFiles: fromProto ? workspace.protoLibrary : undefined,
      entryFile: fromProto ? request.activeProtoFile : undefined,
    })
      .then((result) => {
        if (!cancelled) setSchema(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [request, workspace]);

  const inputStream = request.methodType === "client-stream" || request.methodType === "bidi";
  const outputStream = request.methodType === "server-stream" || request.methodType === "bidi";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div className="flex max-h-[84vh] w-[720px] flex-col rounded-lg border border-th-border bg-th-elevated shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-th-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-mono text-[15px] font-semibold text-th-text-1">{request.method}</h2>
              <span className="shrink-0 rounded bg-th-accent-bg px-2 py-0.5 font-mono text-[10px] text-th-accent-text">{METHOD_TYPE_LABEL[request.methodType]}</span>
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-th-text-4">{request.service}</p>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-[18px] text-th-text-3 hover:bg-th-hover hover:text-th-text-1">×</button>
        </div>

        <div className="min-h-[260px] flex-1 overflow-auto p-5">
          {!schema && !error && <div className="grid min-h-[220px] place-items-center font-mono text-[12px] text-th-text-4">Loading descriptor…</div>}
          {error && <div className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 font-mono text-[12px] text-rose-300 break-words">{error}</div>}
          {schema && (
            <div className="flex flex-col gap-3">
              <div className="rounded-md bg-th-bg px-3 py-2.5 font-mono text-[12px] text-th-text-2 break-all">
                rpc {request.method} ({inputStream ? "stream " : ""}{shortType(schema.inputType)}) returns ({outputStream ? "stream " : ""}{shortType(schema.outputType)})
              </div>
              <MessageSchema label="Request" typeName={schema.inputType} fields={schema.fields} open />
              <MessageSchema label="Response" typeName={schema.outputType} fields={schema.outputFields} open />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
