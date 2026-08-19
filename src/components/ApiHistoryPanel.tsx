import React, { useEffect, useState } from "react";
import { gitHistoryForNode } from "../lib/tauri";
import { buildHistoryTimeline, HistoryTimelineEntry } from "../lib/apiDiff";
import { useWorkspace } from "../store";

function dateLabel(isoDate: string): string {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (isoDate === todayStr) return "Today";
  if (isoDate === yesterdayStr) return "Yesterday";
  return new Date(isoDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const DIFF_COLOR: Record<string, string> = {
  added: "text-emerald-400",
  removed: "text-rose-400",
  changed: "text-amber-400",
};

export default function ApiHistoryPanel({ nodeId }: { nodeId: string }) {
  const { workspaceDir } = useWorkspace();
  const [timeline, setTimeline] = useState<HistoryTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceDir) {
      setTimeline(null);
      return;
    }
    let cancelled = false;
    gitHistoryForNode(workspaceDir, nodeId)
      .then((entries) => {
        if (cancelled) return;
        setTimeline(buildHistoryTimeline(entries));
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceDir, nodeId]);

  if (!workspaceDir) {
    return <p className="text-[12.5px] text-th-text-4 font-mono">Save this workspace to a folder first.</p>;
  }
  if (error) {
    return <p className="text-[12.5px] text-rose-400 font-mono">{error}</p>;
  }
  if (timeline === null) {
    return <p className="text-[12.5px] text-th-text-4 font-mono">Loading…</p>;
  }
  if (timeline.length === 0) {
    return <p className="text-[12.5px] text-th-text-4 font-mono">No commit history yet for this request.</p>;
  }

  let lastDate: string | null = null;

  return (
    <div className="flex flex-col gap-3">
      {timeline.map((entry) => {
        const label = dateLabel(entry.date);
        const showDateHeader = label !== lastDate;
        lastDate = label;
        return (
          <React.Fragment key={entry.hash}>
            {showDateHeader && (
              <div className="flex items-center gap-2 mt-1 first:mt-0">
                <span className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide shrink-0">{label}</span>
                <span className="flex-1 border-t border-th-border" />
              </div>
            )}
            <div className="pl-2 border-l-2 border-th-border">
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="font-medium text-th-text-1">{entry.author}</span>
                <span className="text-th-text-3 truncate">{entry.message}</span>
              </div>
              {entry.diffLines === null ? (
                <p className="text-[11.5px] font-mono text-th-text-4 italic mt-1">initial version</p>
              ) : entry.diffLines.length === 0 ? (
                <p className="text-[11.5px] font-mono text-th-text-4 italic mt-1">no API-surface changes</p>
              ) : (
                <div className="flex flex-col gap-0.5 mt-1">
                  {entry.diffLines.map((d, i) => (
                    <span key={i} className={`text-[11.5px] font-mono ${DIFF_COLOR[d.kind]}`}>
                      {d.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
