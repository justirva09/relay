import React, { useMemo, useState } from "react";
import { GrpcMethodType } from "../../types";

const METHOD_TYPE_LABEL: Record<GrpcMethodType, string> = {
  unary: "unary",
  "server-stream": "server stream",
  "client-stream": "client stream",
  bidi: "bidi stream",
};

export interface GrpcCatalogMethodLike {
  name: string;
  methodType: GrpcMethodType;
}

export interface GrpcCatalogServiceLike {
  name: string;
  methods: GrpcCatalogMethodLike[];
}

interface Props {
  services: GrpcCatalogServiceLike[];
  selectedService: string;
  selectedMethod: string;
  onSelect: (service: string, method: string, methodType: GrpcMethodType) => void;
}

export default function GrpcServicePicker({ services, selectedService, selectedMethod, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services
      .map((s) => ({ ...s, methods: s.methods.filter((m) => `${s.name}.${m.name}`.toLowerCase().includes(q)) }))
      .filter((s) => s.methods.length > 0);
  }, [services, query]);

  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search service or method"
        className="bg-th-bg border border-th-border-input rounded-md px-3 py-1.5 text-[12.5px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
      />
      <div className="flex flex-col gap-3">
        {filtered.map((service) => (
          <div key={service.name}>
            <div className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1">{service.name}</div>
            <div className="flex flex-col gap-0.5">
              {service.methods.map((m) => {
                const active = selectedService === service.name && selectedMethod === m.name;
                return (
                  <button
                    key={m.name}
                    onClick={() => onSelect(service.name, m.name, m.methodType)}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-left transition-colors ${
                      active ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-1 hover:bg-th-hover"
                    }`}
                  >
                    <span className="font-mono">{m.name}</span>
                    <span className="text-[10.5px] font-mono text-th-text-3 shrink-0">{METHOD_TYPE_LABEL[m.methodType]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <span className="text-[12px] text-th-text-4 font-mono">no matches</span>}
      </div>
    </div>
  );
}
