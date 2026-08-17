import React, { useEffect, useState } from "react";
import { useWorkspace } from "../store";
import { TreeNode } from "../types";
import { gitStatus, GitStatusInfo } from "../lib/tauri";
import { METHOD_COLOR } from "./Sidebar";

interface WorkspaceStats {
  httpCount: number;
  grpcCount: number;
  folderCount: number;
  maxDepth: number;
  methodCounts: Record<string, number>;
  grpcMethodTypeCounts: Record<string, number>;
  grpcProtoSourceCounts: { reflection: number; imported: number };
}

function computeStats(tree: TreeNode[]): WorkspaceStats {
  const stats: WorkspaceStats = {
    httpCount: 0,
    grpcCount: 0,
    folderCount: 0,
    maxDepth: 0,
    methodCounts: {},
    grpcMethodTypeCounts: {},
    grpcProtoSourceCounts: { reflection: 0, imported: 0 },
  };

  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === "folder") {
        stats.folderCount++;
        stats.maxDepth = Math.max(stats.maxDepth, depth + 1);
        walk(n.children, depth + 1);
      } else if (n.kind === "request") {
        stats.httpCount++;
        stats.methodCounts[n.request.method] = (stats.methodCounts[n.request.method] || 0) + 1;
      } else if (n.kind === "grpc") {
        stats.grpcCount++;
        stats.grpcMethodTypeCounts[n.request.methodType] = (stats.grpcMethodTypeCounts[n.request.methodType] || 0) + 1;
        stats.grpcProtoSourceCounts[n.request.protoSource]++;
      }
    }
  };
  walk(tree, 0);
  return stats;
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-th-surface border border-th-border rounded-lg px-5 py-4 flex flex-col gap-1">
      <span className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide">{label}</span>
      <span className="text-[28px] font-semibold text-th-text-1 leading-none">{value}</span>
      {sub && <span className="text-[11.5px] text-th-text-3 font-mono">{sub}</span>}
    </div>
  );
}

function BreakdownRow({ label, count, total, color }: { label: string; count: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-[12.5px]">
      <span className={`font-mono font-semibold w-20 shrink-0 ${color || "text-th-text-2"}`}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-th-bg overflow-hidden">
        <div className="h-full bg-th-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-th-text-3 w-8 text-right shrink-0">{count}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-th-surface border border-th-border rounded-lg px-5 py-4 flex flex-col gap-3">
      <h3 className="text-[12px] font-mono text-th-text-3 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

export default function OverviewPage() {
  const { workspace, workspaceDir } = useWorkspace();
  const [git, setGit] = useState<GitStatusInfo | null | undefined>(undefined);

  useEffect(() => {
    if (!workspaceDir) {
      setGit(null);
      return;
    }
    let cancelled = false;
    gitStatus(workspaceDir)
      .then((info) => { if (!cancelled) setGit(info); })
      .catch(() => { if (!cancelled) setGit(null); });
    return () => {
      cancelled = true;
    };
  }, [workspaceDir]);

  const stats = computeStats(workspace.tree);
  const totalRequests = stats.httpCount + stats.grpcCount;
  const activeEnv = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
  const globalSecretCount = workspace.variables.filter((v) => v.secret).length;
  const envSecretCount = workspace.environments.reduce((sum, e) => sum + e.variables.filter((v) => v.secret).length, 0);

  const methodEntries = Object.entries(stats.methodCounts).sort((a, b) => b[1] - a[1]);
  const grpcTypeEntries = Object.entries(stats.grpcMethodTypeCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-8 py-8 flex flex-col gap-6">
        <div>
          <h1 className="text-[20px] font-semibold text-th-text-1">{workspace.name || "Workspace"}</h1>
          <p className="text-[13px] text-th-text-3 font-mono mt-0.5">{workspaceDir || "Not saved to disk yet"}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="HTTP requests" value={stats.httpCount} />
          <StatCard label="gRPC requests" value={stats.grpcCount} />
          <StatCard label="Folders" value={stats.folderCount} sub={stats.maxDepth > 0 ? `${stats.maxDepth} level${stats.maxDepth === 1 ? "" : "s"} deep` : undefined} />
          <StatCard label="Total requests" value={totalRequests} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Section title="HTTP methods">
            {methodEntries.length === 0 ? (
              <p className="text-[12px] text-th-text-4 font-mono">No HTTP requests yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                {methodEntries.map(([method, count]) => (
                  <BreakdownRow key={method} label={method} count={count} total={stats.httpCount} color={METHOD_COLOR[method]} />
                ))}
              </div>
            )}
          </Section>

          <Section title="gRPC">
            {grpcTypeEntries.length === 0 ? (
              <p className="text-[12px] text-th-text-4 font-mono">No gRPC requests yet</p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {grpcTypeEntries.map(([type, count]) => (
                    <BreakdownRow key={type} label={type} count={count} total={stats.grpcCount} />
                  ))}
                </div>
                <div className="flex items-center gap-4 text-[11.5px] font-mono text-th-text-3 pt-1 border-t border-th-border">
                  <span>{stats.grpcProtoSourceCounts.reflection} reflection</span>
                  <span>{stats.grpcProtoSourceCounts.imported} imported proto</span>
                  <span>{workspace.protoLibrary.length} proto file{workspace.protoLibrary.length === 1 ? "" : "s"}</span>
                </div>
              </>
            )}
          </Section>

          <Section title="Environments & variables">
            <div className="flex flex-col gap-1.5 text-[12.5px] font-mono">
              <div className="flex items-center justify-between">
                <span className="text-th-text-3">Environments</span>
                <span className="text-th-text-1">{workspace.environments.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-th-text-3">Active environment</span>
                <span className={activeEnv ? "text-emerald-400" : "text-th-text-4"}>{activeEnv?.name || "None"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-th-text-3">Global variables</span>
                <span className="text-th-text-1">{workspace.variables.filter((v) => v.key.trim()).length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-th-text-3">Secret variables</span>
                <span className="text-th-text-1">{globalSecretCount + envSecretCount}</span>
              </div>
            </div>
          </Section>

          <Section title="Git">
            {git === undefined ? (
              <p className="text-[12px] text-th-text-4 font-mono">Checking…</p>
            ) : git === null ? (
              <p className="text-[12px] text-th-text-4 font-mono">{workspaceDir ? "Not a git repo" : "Workspace not saved to disk yet"}</p>
            ) : (
              <div className="flex flex-col gap-1.5 text-[12.5px] font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-th-text-3">Branch</span>
                  <span className="text-th-text-1">{git.branch}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-th-text-3">Uncommitted changes</span>
                  <span className={git.files.length > 0 ? "text-amber-400" : "text-th-text-1"}>{git.files.length}</span>
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
