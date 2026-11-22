import { useState } from "react";
import { useWorkspace } from "../../store";
import { pickSavePath, writeFileAtPath } from "../../lib/tauri";
import { generateDocsHtml } from "../../lib/docsGen";
import { SectionHeading } from "./shared";

export function ImportExportSection() {
  const { workspace, importCollection, importVariables, exportVariables, importBrunoCollection, exportCollection } = useWorkspace();
  const [status, setStatus] = useState<string | null>(null);

  const handleGenerateDocs = async () => {
    try {
      const name = (workspace.name?.trim() || "docs").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const path = await pickSavePath(`${name}.html`, "HTML", ["html"]);
      if (!path) return;
      await writeFileAtPath(path, generateDocsHtml(workspace));
      setStatus("Docs generated.");
    } catch (e: any) {
      setStatus(`Docs generation failed: ${e.message || e}`);
    }
  };

  return (
    <div>
      <SectionHeading title="Import & Export" desc="Import Relay, Postman, OpenAPI, Insomnia v4/v5, Apidog OpenAPI/Postman exports, or a native Bruno folder. Export selected requests as Postman or OpenAPI 3.0." />
      <p className="text-[11.5px] text-th-text-3 -mt-2 mb-3">Secret values are intentionally left blank in exported files.</p>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => importCollection()}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Import File
        </button>
        <button
          onClick={() => importBrunoCollection()}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h6l2 2h10v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            <path d="M3 7V5a2 2 0 012-2h4l2 2h4" />
          </svg>
          Bruno Folder
        </button>
        <button
          onClick={exportCollection}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Export
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          onClick={() => importVariables()}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text"
        >
          Import Variables
        </button>
        <button
          onClick={async () => {
            try {
              if (await exportVariables()) setStatus("Variables exported. Secret values were omitted.");
            } catch (e: any) {
              setStatus(`Variable export failed: ${e.message || e}`);
            }
          }}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text"
        >
          Export Variables
        </button>
      </div>
      <button
        onClick={handleGenerateDocs}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-th-bg border border-th-border-input text-th-text-1 hover:border-th-accent-border hover:text-th-accent-text mt-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        Generate Docs (HTML)
      </button>
      {status && <p className="text-[12px] text-th-text-2 mt-2 font-mono">{status}</p>}
    </div>
  );
}
