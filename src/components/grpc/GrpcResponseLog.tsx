import React from "react";
import { useEffect, useRef } from "react";
import { GrpcLogEntry } from "../../types";
import { JsonTree, isJson } from "../JsonTree";

function DirectionBadge({ direction }: { direction: GrpcLogEntry["direction"] }) {
  if (direction === "sent") {
    return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-th-accent-text bg-th-accent-bg">SENT</span>;
  }
  if (direction === "error") {
    return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-rose-400 bg-rose-400/10">ERROR</span>;
  }
  return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold text-emerald-400 bg-emerald-400/10">RECV</span>;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function GrpcResponseLog({ log, streaming }: { log: GrpcLogEntry[]; streaming: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const receivedCount = log.filter((entry) => entry.direction === "received").length;

  useEffect(() => {
    if (streaming) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [log.length, streaming]);

  if (log.length === 0 && !streaming) {
    return (
      <div className="h-full grid place-items-center text-th-text-4 text-[13px] font-mono">
        response will appear here
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 flex items-center gap-3 text-[12.5px] font-mono shrink-0">
        {streaming ? (
          <span className="text-th-text-3">{receivedCount} received · streaming…</span>
        ) : (
          <span className="text-th-text-2">{receivedCount} received · {log.length} event{log.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 flex flex-col gap-3">
        {log.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <DirectionBadge direction={entry.direction} />
              <span className="text-[11px] font-mono text-th-text-4">{formatTime(entry.timestamp)}</span>
            </div>
            {entry.direction === "error" ? (
              <p className="text-[12.5px] font-mono text-rose-300 leading-relaxed">{entry.json}</p>
            ) : isJson(entry.json) ? (
              <JsonTree text={entry.json} />
            ) : (
              <pre className="text-[12.5px] font-mono text-th-text-1 whitespace-pre-wrap">{entry.json}</pre>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
