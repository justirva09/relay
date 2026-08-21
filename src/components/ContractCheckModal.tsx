import React, { useEffect, useState } from "react";
import { RequestData, ResponseState } from "../types";
import { useWorkspace } from "../store";
import { runRequest, mergedVariables } from "../lib/useSendRequest";
import { compareTestResults, diffJsonShape } from "../lib/contractDiff";

function StatusChip({ response }: { response: ResponseState | null }) {
  if (!response) return <span className="text-th-text-4 text-[12px] font-mono">running…</span>;
  if (response.error) return <span className="text-[12px] font-mono text-rose-400">error</span>;
  const ok = response.ok;
  return (
    <span className={`text-[13px] font-mono font-semibold px-1.5 py-0.5 rounded ring-1 ${ok ? "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30" : "text-rose-400 bg-rose-400/10 ring-rose-400/30"}`}>
      {response.status} · {response.time}ms
    </span>
  );
}

// sends the same request to the mock server and the active environment,
// then diffs the two. side-effect-free, doesn't touch the draft or saved state
export default function ContractCheckModal({ draft, mockPort, onClose }: { draft: RequestData; mockPort: number; onClose: () => void }) {
  const { workspace, safeMode } = useWorkspace();
  const [mock, setMock] = useState<ResponseState | null>(null);
  const [real, setReal] = useState<ResponseState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const variables = mergedVariables(workspace);
    const noop = () => {};
    runRequest(draft, variables, noop, { overrideOrigin: `http://127.0.0.1:${mockPort}`, safeMode }).then((r) => !cancelled && setMock(r));
    runRequest(draft, variables, noop, { safeMode }).then((r) => !cancelled && setReal(r));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = !mock || !real;
  const testComparison = mock && real ? compareTestResults(mock.testResults, real.testResults) : [];
  const shapeMismatches = mock && real && !mock.error && !real.error ? diffJsonShape(mock.body, real.body) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[720px] max-h-[82vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-semibold text-th-text-1">Contract Check — Mock vs Real</h2>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col gap-4 text-[12.5px] font-mono">
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-th-border rounded-md px-3 py-2.5 bg-th-bg">
              <p className="text-[10.5px] uppercase tracking-wide text-th-text-4 font-bold mb-1.5">Mock · 127.0.0.1:{mockPort}</p>
              <StatusChip response={mock} />
            </div>
            <div className="border border-th-border rounded-md px-3 py-2.5 bg-th-bg">
              <p className="text-[10.5px] uppercase tracking-wide text-th-text-4 font-bold mb-1.5">Real · active environment</p>
              <StatusChip response={real} />
            </div>
          </div>

          {loading && <p className="text-th-text-4">Sending to both targets…</p>}

          {!loading && testComparison.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-th-text-4 font-bold mb-1.5">Tests</p>
              <div className="flex flex-col gap-1">
                {testComparison.map((t) => (
                  <div key={t.name} className="flex items-center gap-2 border border-th-border rounded px-2.5 py-1.5 bg-th-bg">
                    <span className={t.mock === null ? "text-th-text-4" : t.mock ? "text-emerald-400" : "text-rose-400"}>{t.mock === null ? "—" : t.mock ? "✓" : "✗"}</span>
                    <span className={t.real === null ? "text-th-text-4" : t.real ? "text-emerald-400" : "text-rose-400"}>{t.real === null ? "—" : t.real ? "✓" : "✗"}</span>
                    <span className="text-th-text-2 truncate">{t.name}</span>
                    {t.mock !== t.real && <span className="ml-auto shrink-0 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300">mismatch</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-th-text-4 font-bold mb-1.5">Contract</p>
              {shapeMismatches.length === 0 ? (
                <p className="text-emerald-400">No shape differences between mock and real response bodies.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {shapeMismatches.map((m) => (
                    <div key={m.path} className="border border-amber-400/30 bg-amber-400/10 rounded px-2.5 py-1.5">
                      <span className="text-th-text-1">{m.path}</span>
                      <span className="text-th-text-3"> — mock: </span>
                      <span className="text-amber-300">{m.mockType}</span>
                      <span className="text-th-text-3">, real: </span>
                      <span className="text-amber-300">{m.realType}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
