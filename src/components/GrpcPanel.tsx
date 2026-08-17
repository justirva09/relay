import React, { useEffect, useRef, useState } from "react";
import { GrpcRequestData, GrpcMethodType, defaultMessageForMethodType } from "../types";
import { MOCK_GRPC_SERVICES } from "../lib/grpcMock";
import { listGrpcServices, listGrpcServicesFromProto, listProtoServiceFiles, fetchGrpcMethodSchema, GrpcCatalogService, ProtoFieldSchema } from "../lib/grpcClient";
import CodeEditor from "./CodeEditor";
import KeyValueEditor from "./KeyValueEditor";
import GrpcServicePicker from "./GrpcServicePicker";

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
}

const METHOD_TYPE_BADGE: Record<GrpcMethodType, string> = {
  unary: "unary",
  "server-stream": "server-stream",
  "client-stream": "client-stream",
  bidi: "bidi",
};

function GrpcMethodDropdown({ url, protoSource, protoFiles, activeProtoFile, service, method, onSelect }: {
  url: string;
  protoSource: "reflection" | "imported";
  protoFiles: { name: string; content: string }[];
  activeProtoFile?: string;
  service: string;
  method: string;
  onSelect: (service: string, method: string, methodType: GrpcMethodType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<GrpcCatalogService[]>(MOCK_GRPC_SERVICES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (open) reflect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protoSource, activeProtoFile]);

  const reflect = () => {
    if (protoSource === "reflection") {
      setLoading(true);
      setError(null);
      listGrpcServices(url)
        .then((list) => setServices(list))
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
      return;
    }

    if (protoSource === "imported") {
      const activeFile = protoFiles.find((f) => f.name === activeProtoFile);
      if (!activeFile) {
        setServices([]);
        setError("select a .proto file first");
        return;
      }
      setLoading(true);
      setError(null);
      listGrpcServicesFromProto(protoFiles, activeFile.name)
        .then((list) => setServices(list))
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) reflect();
        }}
        className="w-full flex items-center gap-2 bg-th-surface border border-th-border-input rounded-md px-3 py-2 text-[13px] font-mono text-th-text-1 hover:border-th-text-4"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-th-text-3 shrink-0">
          <path d="M8 3L4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />
        </svg>
        {method ? (
          <span className="truncate">
            <span className="text-th-text-3">{service}</span> / <span className="text-th-text-1 font-semibold">{method}</span>
          </span>
        ) : (
          <span className="text-th-text-4">select method</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-th-text-3 shrink-0 ml-auto">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl p-2 min-w-[420px] max-h-[420px] overflow-y-auto">
          <div className="flex items-center justify-between gap-2 px-1 pb-2 mb-1 border-b border-th-border">
            <span className="text-[11px] font-mono text-th-text-3">
              {loading
                ? protoSource === "reflection" ? "reflecting…" : "parsing…"
                : error
                ? "failed to list services"
                : `${services.length} service${services.length === 1 ? "" : "s"} found`}
            </span>
            <button
              onClick={reflect}
              disabled={loading}
              className="px-2 py-0.5 rounded text-[11px] font-mono text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg disabled:opacity-50"
            >
              {loading ? "…" : protoSource === "reflection" ? "↻ reflect" : "↻ reparse"}
            </button>
          </div>
          {error && <p className="text-[11.5px] font-mono text-rose-400 px-1 pb-2 leading-relaxed">{error}</p>}
          <GrpcServicePicker
            services={services}
            selectedService={service}
            selectedMethod={method}
            onSelect={(s, m, t) => {
              onSelect(s, m, t);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function ActiveProtoFilePicker({ files, active, onSelect, onRemove }: {
  files: { name: string; content: string }[];
  active?: string;
  onSelect: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const filtered = files.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()));

  const groups = new Map<string, { name: string; content: string }[]>();
  for (const f of filtered) {
    const segments = f.name.split("/");
    const groupKey = segments.slice(0, 2).join("/");
    const list = groups.get(groupKey);
    if (list) list.push(f);
    else groups.set(groupKey, [f]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-th-surface border border-th-border-input rounded-md px-3 py-2 text-[12.5px] font-mono text-th-text-1 hover:border-th-text-4"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-th-text-3 shrink-0">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="truncate">{active || "select a .proto file"}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-th-text-3 shrink-0 ml-auto">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-th-elevated border border-th-border rounded-md shadow-xl p-2 max-h-[420px] overflow-y-auto flex flex-col gap-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search spec file"
            className="bg-th-bg border border-th-border-input rounded-md px-3 py-1.5 text-[12.5px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
          />
          <div className="flex flex-col gap-3">
            {Array.from(groups.entries()).map(([groupKey, groupFiles]) => (
              <div key={groupKey}>
                <div className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1">
                  {groupKey.split("/").join(".")}
                </div>
                <div className="flex flex-col gap-0.5">
                  {groupFiles.map((f) => {
                    const isActive = active === f.name;
                    const rest = f.name.slice(groupKey.length + 1) || f.name;
                    return (
                      <div
                        key={f.name}
                        className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 ${
                          isActive ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-1 hover:bg-th-hover"
                        }`}
                      >
                        <button
                          onClick={() => {
                            onSelect(f.name);
                            setOpen(false);
                          }}
                          className="flex-1 min-w-0 text-left text-[12.5px] font-mono truncate"
                          title={f.name}
                        >
                          {rest}
                        </button>
                        <button
                          onClick={() => onRemove(f.name)}
                          className="h-5 w-5 grid place-items-center rounded text-th-text-4 hover:text-rose-400 hover:bg-rose-400/10 shrink-0"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <span className="text-[12px] text-th-text-4 font-mono px-1">no matches</span>}
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  draft: GrpcRequestData;
  streaming: boolean;
  onChange: (patch: Partial<GrpcRequestData>) => void;
  onSend: () => void;
  protoFiles: { name: string; content: string }[];
  onImportProto: () => void;
  onRemoveProto: (name: string) => void;
}

export default function GrpcPanel({ draft, streaming, onChange, onSend, protoFiles, onImportProto, onRemoveProto }: Props) {
  const [tab, setTab] = useState<"message" | "metadata" | "definition">("message");
  const [serviceFiles, setServiceFiles] = useState<Set<string>>(new Set());
  const [schemaFields, setSchemaFields] = useState<ProtoFieldSchema[] | undefined>(undefined);

  const handleSelectMethod = (service: string, method: string, methodType: GrpcMethodType) => {
    onChange({ service, method, methodType, messageJson: defaultMessageForMethodType(methodType) });
    setSchemaFields(undefined);
    const canUseImportedProto = draft.protoSource === "imported" && !!draft.activeProtoFile;
    fetchGrpcMethodSchema({
      url: draft.url,
      service,
      method,
      protoFiles: canUseImportedProto ? protoFiles : undefined,
      entryFile: canUseImportedProto ? draft.activeProtoFile : undefined,
    })
      .then((schema) => {
        setSchemaFields(schema.fields);
        const template = methodType === "client-stream" || methodType === "bidi" ? `[\n${indent(schema.template)}\n]` : schema.template;
        onChange({ messageJson: template });
      })
      .catch(() => {}); // schema is a nicety — keep the plain default message on failure (e.g. unreachable server)
  };

  // Reopening a request that already has a service/method picked (a saved
  // request, or switching back to a tab) doesn't go through handleSelectMethod
  // — it needs its own schema fetch so field autocomplete comes back without
  // the user having to re-pick the method every time.
  useEffect(() => {
    if (!draft.service || !draft.method) {
      setSchemaFields(undefined);
      return;
    }
    let cancelled = false;
    const canUseImportedProto = draft.protoSource === "imported" && !!draft.activeProtoFile;
    fetchGrpcMethodSchema({
      url: draft.url,
      service: draft.service,
      method: draft.method,
      protoFiles: canUseImportedProto ? protoFiles : undefined,
      entryFile: canUseImportedProto ? draft.activeProtoFile : undefined,
    })
      .then((schema) => {
        if (!cancelled) setSchemaFields(schema.fields);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.service, draft.method, draft.protoSource, draft.activeProtoFile]);

  useEffect(() => {
    if (protoFiles.length === 0) {
      setServiceFiles(new Set());
      return;
    }
    let cancelled = false;
    listProtoServiceFiles(protoFiles).then((names) => {
      if (!cancelled) setServiceFiles(new Set(names));
    });
    return () => {
      cancelled = true;
    };
  }, [protoFiles]);

  const pickableProtoFiles = protoFiles.filter((f) => serviceFiles.has(f.name));

  const messagePlaceholder =
    draft.methodType === "client-stream" || draft.methodType === "bidi"
      ? '[\n  { "field": "value" }\n]'
      : '{\n  "field": "value"\n}';

  const enabledMetadataCount = draft.metadata.filter((m) => m.enabled && m.key.trim()).length;

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 flex items-center gap-2">
        <div className="relative w-[220px] shrink-0 bg-th-surface border border-th-border-input rounded-md">
          <input
            value={draft.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="grpc://localhost:50051"
            spellCheck={false}
            className="w-full px-3 py-2 text-[13px] font-mono bg-transparent text-th-text-1 placeholder:text-th-text-4 focus:outline-none"
          />
        </div>
        <GrpcMethodDropdown
          url={draft.url}
          protoSource={draft.protoSource}
          protoFiles={protoFiles}
          activeProtoFile={draft.activeProtoFile}
          service={draft.service}
          method={draft.method}
          onSelect={handleSelectMethod}
        />
        <button
          onClick={onSend}
          disabled={streaming || !draft.method}
          className="px-4 py-2 rounded-md text-[13px] font-semibold border border-transparent bg-th-accent text-white hover:bg-th-accent-hover transition-colors shrink-0 disabled:opacity-60"
        >
          {streaming ? "Streaming…" : "Send"}
        </button>
      </div>

      {draft.method && (
        <div className="px-4 pt-1.5 flex items-center gap-1.5 text-[11.5px] font-mono" title={`${draft.service}.${draft.method}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-th-text-4 shrink-0">
            <path d="M8 3L4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />
          </svg>
          <span className="text-th-text-3 truncate min-w-0">{draft.service}</span>
          <span className="text-th-text-4 shrink-0">/</span>
          <span className="text-th-accent-text font-semibold shrink-0">{draft.method}</span>
        </div>
      )}

      <div className="px-4 mt-4">
        <div className="flex items-center gap-4 border-b border-th-border text-[12.5px] font-mono overflow-x-auto overflow-y-hidden">
          {(
            [
              ["message", "Message"],
              ["metadata", `Metadata${enabledMetadataCount ? ` (${enabledMetadataCount})` : ""}`],
              ["definition", "Service definition"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-2 -mb-px border-b-2 whitespace-nowrap transition-colors ${
                tab === key ? "border-th-accent text-th-accent-text" : "border-transparent text-th-text-3 hover:text-th-text-1"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        {tab === "message" && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-end">
              <button
                onClick={() => {
                  try {
                    const formatted = JSON.stringify(JSON.parse(draft.messageJson), null, 2);
                    onChange({ messageJson: formatted });
                  } catch {}
                }}
                className="px-2 py-0.5 rounded text-[11px] font-mono text-th-text-3 hover:text-th-accent-text hover:bg-th-accent-bg"
              >
                Prettify
              </button>
            </div>
            <CodeEditor
              value={draft.messageJson}
              onChange={(v) => onChange({ messageJson: v })}
              placeholder={messagePlaceholder}
              protoFields={schemaFields}
              className="h-48 bg-th-surface border border-th-border-input rounded-md focus-within:border-th-border-focus"
            />
            <span className="text-[11px] text-th-text-4 font-mono">
              {draft.methodType === "client-stream" || draft.methodType === "bidi"
                ? "JSON array — every element sent in sequence when you hit Send"
                : "single JSON object"}
              {draft.method && ` · ${METHOD_TYPE_BADGE[draft.methodType]}`}
            </span>
          </div>
        )}
        {tab === "metadata" && (
          <KeyValueEditor rows={draft.metadata} onChangeRows={(rows) => onChange({ metadata: rows })} placeholderKey="metadata key" placeholderVal="value" />
        )}
        {tab === "definition" && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide">Service discovery</span>
            <div className="flex gap-1.5">
              {(["reflection", "imported"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onChange({ protoSource: mode })}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-mono ring-1 transition-colors ${
                    draft.protoSource === mode ? "bg-th-accent-bg text-th-accent-text ring-th-accent-border" : "bg-th-surface text-th-text-3 ring-th-border-input hover:text-th-text-1"
                  }`}
                >
                  {mode === "reflection" ? "Server reflection" : "Imported .proto"}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-th-text-4 font-mono">
              {draft.protoSource === "reflection"
                ? "queries the server's reflection API for available services"
                : "uses .proto files imported into the workspace's shared proto library"}
            </span>

            {draft.protoSource === "imported" && (
              <div className="mt-2 flex flex-col gap-2">
                {protoFiles.length === 0 ? (
                  <span className="text-[12px] text-th-text-4 font-mono">
                    no .proto files imported yet — import a folder to get started
                  </span>
                ) : pickableProtoFiles.length === 0 ? (
                  <span className="text-[12px] text-th-text-4 font-mono">
                    {protoFiles.length} file{protoFiles.length === 1 ? "" : "s"} imported, but none declare a service — only message/entity files were found
                  </span>
                ) : (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-mono text-th-text-4">
                      pick the active spec file — its declared services show up in the method picker
                    </span>
                    <ActiveProtoFilePicker
                      files={pickableProtoFiles}
                      active={draft.activeProtoFile}
                      onSelect={(name) => onChange({ activeProtoFile: name, service: "", method: "" })}
                      onRemove={onRemoveProto}
                    />
                  </div>
                )}
                <button
                  onClick={onImportProto}
                  className="self-start px-3 py-1.5 rounded-md text-[12px] font-mono border border-dashed border-th-border text-th-text-3 hover:text-th-accent-text hover:border-th-accent-border"
                >
                  Import a .proto folder
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
