import React, { useEffect, useMemo, useState } from "react";
import { GrpcCatalogService, listGrpcServices } from "../../lib/grpcClient";
import { GrpcApiImportService } from "../../store/useTreeActions";
import { GrpcMethodType } from "../../types";
import { substituteVars } from "../../lib/pm";

const METHOD_LABEL: Record<GrpcMethodType, string> = {
  unary: "unary",
  "server-stream": "server stream",
  "client-stream": "client stream",
  bidi: "bidi stream",
};

function methodKey(service: string, method: string): string {
  return `${service}\u0000${method}`;
}

function suggestedApiName(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `grpc://${value}`).host || "gRPC API";
  } catch {
    return "gRPC API";
  }
}

export default function GrpcReflectionImportModal({
  onImport,
  onClose,
  variableValues,
}: {
  onImport: (apiName: string, url: string, services: GrpcApiImportService[]) => void;
  onClose: () => void;
  variableValues: Record<string, string>;
}) {
  const [url, setUrl] = useState("grpc://localhost:50051");
  const [apiName, setApiName] = useState("localhost:50051");
  const [nameEdited, setNameEdited] = useState(false);
  const [catalog, setCatalog] = useState<GrpcCatalogService[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const allKeys = useMemo(
    () => catalog?.flatMap((service) => service.methods.map((method) => methodKey(service.name, method.name))) ?? [],
    [catalog]
  );

  const discover = async () => {
    const endpoint = (substituteVars(url, variableValues) ?? url).trim();
    if (!endpoint || loading) return;
    setLoading(true);
    setError(null);
    try {
      const services = await listGrpcServices(endpoint);
      if (services.length === 0) throw new Error("No gRPC services were exposed by server reflection.");
      setCatalog(services);
      setSelected(new Set(services.flatMap((service) => service.methods.map((method) => methodKey(service.name, method.name)))));
      if (!nameEdited) setApiName(suggestedApiName(endpoint));
    } catch (cause) {
      setCatalog(null);
      setSelected(new Set());
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const toggleMethod = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleService = (service: GrpcCatalogService) => {
    const keys = service.methods.map((method) => methodKey(service.name, method.name));
    const selectService = keys.some((key) => !selected.has(key));
    setSelected((current) => {
      const next = new Set(current);
      keys.forEach((key) => (selectService ? next.add(key) : next.delete(key)));
      return next;
    });
  };

  const handleImport = () => {
    if (!catalog || selected.size === 0) return;
    const services = catalog
      .map((service) => ({
        name: service.name,
        methods: service.methods
          .filter((method) => selected.has(methodKey(service.name, method.name)))
          .map((method) => ({ ...method, template: method.template ?? "{}" })),
      }))
      .filter((service) => service.methods.length > 0);
    onImport(apiName.trim() || suggestedApiName(url), url.trim(), services);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[620px] max-h-[84vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[16px] font-semibold text-th-text-1">Import gRPC API</h2>
            <p className="text-[11.5px] text-th-text-4 mt-0.5">Discover services and create requests using Server Reflection.</p>
          </div>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="px-5 pb-4 flex-1 min-h-0 overflow-auto flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label className="text-[11px] font-mono text-th-text-3 mb-1.5 block">Server URL</label>
              <input
                autoFocus
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setCatalog(null);
                  setSelected(new Set());
                  setError(null);
                  if (!nameEdited) setApiName(suggestedApiName(event.target.value));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void discover();
                }}
                placeholder="grpc://api.example.com:443"
                spellCheck={false}
                className="w-full bg-th-bg border border-th-border-input rounded-md px-3 py-2 text-[12.5px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
              />
            </div>
            <button
              onClick={() => void discover()}
              disabled={!url.trim() || loading}
              className="self-end px-4 py-2 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-40 disabled:cursor-default"
            >
              {loading ? "Discovering…" : "Discover"}
            </button>
          </div>

          {error && <div className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-[12px] font-mono text-rose-300 break-words">{error}</div>}

          {catalog && (
            <>
              <div>
                <label className="text-[11px] font-mono text-th-text-3 mb-1.5 block">API name</label>
                <input
                  value={apiName}
                  onChange={(event) => {
                    setApiName(event.target.value);
                    setNameEdited(true);
                  }}
                  className="w-full bg-th-bg border border-th-border-input rounded-md px-3 py-2 text-[12.5px] text-th-text-1 focus:outline-none focus:border-th-border-focus"
                />
              </div>

              <div className="border border-th-border rounded-md overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-th-bg border-b border-th-border">
                  <span className="text-[11.5px] font-mono text-th-text-3">
                    {catalog.length} service{catalog.length === 1 ? "" : "s"} · {selected.size}/{allKeys.length} methods selected
                  </span>
                  <button
                    onClick={() => setSelected(selected.size === allKeys.length ? new Set() : new Set(allKeys))}
                    className="text-[11.5px] text-th-accent-text hover:underline"
                  >
                    {selected.size === allKeys.length ? "Select none" : "Select all"}
                  </button>
                </div>
                <div className="max-h-[330px] overflow-auto divide-y divide-th-border">
                  {catalog.map((service) => {
                    const serviceKeys = service.methods.map((method) => methodKey(service.name, method.name));
                    const selectedCount = serviceKeys.filter((key) => selected.has(key)).length;
                    return (
                      <div key={service.name} className="py-2">
                        <label className="flex items-center gap-2 px-3 py-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedCount === service.methods.length}
                            onChange={() => toggleService(service)}
                            className="accent-[var(--accent)]"
                          />
                          <span className="font-mono text-[12px] text-th-text-1 truncate" title={service.name}>{service.name}</span>
                          <span className="ml-auto text-[10.5px] font-mono text-th-text-4">{selectedCount}/{service.methods.length}</span>
                        </label>
                        <div className="ml-6">
                          {service.methods.map((method) => {
                            const key = methodKey(service.name, method.name);
                            return (
                              <label key={method.name} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-th-hover rounded-sm">
                                <input type="checkbox" checked={selected.has(key)} onChange={() => toggleMethod(key)} className="accent-[var(--accent)]" />
                                <span className="font-mono text-[12px] text-th-text-2">{method.name}</span>
                                <span className="ml-auto text-[10px] font-mono text-th-text-4">{METHOD_LABEL[method.methodType]}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-th-border">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-[12.5px] text-th-text-2 hover:text-th-text-1 hover:bg-th-hover">Cancel</button>
          <button
            onClick={handleImport}
            disabled={!catalog || selected.size === 0 || !apiName.trim()}
            className="px-4 py-1.5 rounded-md text-[12.5px] bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-40 disabled:cursor-default"
          >
            Import {selected.size || ""} method{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
