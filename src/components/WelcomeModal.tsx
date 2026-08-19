import React, { useState } from "react";
import { useWorkspace } from "../store";
import appIcon from "../assets/app-icon.png";

const ONBOARDING_KEY = "relay-onboarding-seen";

function Card({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left flex items-start gap-3 border border-th-border-input rounded-lg px-4 py-3.5 hover:border-th-accent-border hover:bg-th-hover transition-colors"
    >
      <span className="shrink-0 h-9 w-9 grid place-items-center rounded-md bg-th-accent-bg text-th-accent-text text-[16px]">{icon}</span>
      <span>
        <p className="text-[13.5px] font-semibold text-th-text-1">{title}</p>
        <p className="text-[12px] text-th-text-3 mt-0.5 leading-relaxed">{desc}</p>
      </span>
    </button>
  );
}

// First-run onboarding — shown once (tracked via localStorage, not tied to
// whether a workspace folder has been picked yet) so a fresh install offers
// the same actionable menu Bruno/Insomnia give new users, instead of the
// current silent drop into a demo workspace with only a thin "no folder
// chosen" banner as the only hint anything's unsaved.
export default function WelcomeModal() {
  const { importCollection, openCurlImport, createWorkspace, addRequest, openTab } = useWorkspace();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const finish = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // localStorage unavailable — worst case this shows again next launch.
    }
    setDismissed(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay">
      <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[600px] max-h-[85vh] overflow-y-auto p-8">
        <div className="text-center mb-7">
          <img src={appIcon} alt="Relay" className="w-14 h-14 rounded-2xl shadow-lg mx-auto mb-3" />
          <h2 className="text-[21px] font-semibold text-th-text-1">Welcome to Relay</h2>
          <p className="text-[13px] text-th-text-3 mt-1.5">A local-first HTTP &amp; gRPC client with Git built in.</p>
        </div>

        <p className="text-[11px] font-mono uppercase tracking-wide text-th-text-4 mb-2">Get started</p>
        <p className="text-[14.5px] font-semibold text-th-text-1 mb-3.5">What would you like to do?</p>

        <div className="grid grid-cols-2 gap-3">
          <Card
            icon="⇩"
            title="Import a Collection"
            desc="Bring in a Postman collection (v2.1) or an OpenAPI 3.x spec."
            onClick={() => {
              importCollection();
              finish();
            }}
          />
          <Card
            icon="❯_"
            title="Import from cURL"
            desc="Paste a curl command copied from docs or DevTools."
            onClick={() => {
              openCurlImport(null);
              finish();
            }}
          />
          <Card
            icon="＋"
            title="Create Collection"
            desc="Pick a folder on disk to start a fresh workspace."
            onClick={() => {
              createWorkspace();
              finish();
            }}
          />
          <Card
            icon="➤"
            title="Start with a Request"
            desc="Jump right in with a new HTTP request."
            onClick={() => {
              const id = addRequest(null);
              if (id) openTab(id);
              finish();
            }}
          />
        </div>

        <div className="text-center mt-6">
          <button onClick={finish} className="text-[12.5px] text-th-text-3 hover:text-th-text-1 underline underline-offset-2">
            I'll explore on my own
          </button>
        </div>
      </div>
    </div>
  );
}
