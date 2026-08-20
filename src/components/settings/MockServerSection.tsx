import { useWorkspace } from "../../store";
import { SectionHeading } from "./shared";

export function MockServerSection() {
  const { mockServerPort, setMockServerPort, mockServerRunningPort, mockServerError, toggleMockServer } = useWorkspace();

  return (
    <div>
      <SectionHeading
        title="Mock Server"
        desc="Runs a local stand-in server that replies from this workspace's cached example responses — not your real backend. Point a frontend at it to develop against an API that isn't running yet."
      />
      <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${mockServerRunningPort ? "bg-emerald-400" : "bg-th-text-4"}`} />
          <span className="text-[12px] font-mono text-th-text-2 truncate">
            {mockServerRunningPort ? `Running at http://localhost:${mockServerRunningPort}` : "Not running"}
          </span>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {!mockServerRunningPort && (
            <input
              type="number"
              value={mockServerPort}
              onChange={(e) => setMockServerPort(Number(e.target.value) || 4010)}
              className="w-20 bg-th-surface border border-th-border-input rounded-md px-2 py-1.5 text-[12.5px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
            />
          )}
          <button
            onClick={toggleMockServer}
            className={`px-3 py-1.5 rounded-md text-[12.5px] font-mono border transition-colors ${
              mockServerRunningPort ? "border-rose-400/40 text-rose-400 hover:bg-rose-400/10" : "border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
            }`}
          >
            {mockServerRunningPort ? "Stop" : "Start"}
          </button>
        </div>
      </div>
      {mockServerError && <p className="text-[12px] text-rose-400 mt-2 font-mono">{mockServerError}</p>}
    </div>
  );
}
