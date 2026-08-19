import React, { useEffect, useState } from "react";
import { getLicenseState, subscribeLicense, hasFeature } from "../lib/license";
import { runAction } from "../lib/keybindings";

// Soft gate — the option stays visible and selectable (so the UI always
// shows what the capability is, per the "Semantic Diff 🔒 → Start Pro"
// pattern), but the actual working controls only render once the local
// signed license (see lib/license.ts) actually has the feature. Client-side
// only: fine for a local-only feature like this, since there's nothing a
// server could enforce here anyway (see the licensing design discussion —
// the goal is a smooth path for legitimate users, not un-crackable DRM).
export default function ProFeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const [, forceRerender] = useState(0);
  useEffect(() => subscribeLicense(() => forceRerender((n) => n + 1)), []);

  if (hasFeature(feature)) return <>{children}</>;

  const signedIn = !!getLicenseState().session;

  return (
    <div className="border border-th-border-input rounded-lg p-4 flex flex-col items-start gap-2">
      <div className="flex items-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-th-text-3">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span className="text-[13px] font-semibold text-th-text-1">Requires Relay Pro</span>
      </div>
      <p className="text-[12px] text-th-text-3">
        {signedIn ? "Your account doesn't have this feature yet." : "Sign in to check whether your account has this feature."}
      </p>
      <button
        onClick={() => runAction("view.settings")}
        className="px-3 py-1.5 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4"
      >
        {signedIn ? "Open Account Settings" : "Sign In"}
      </button>
    </div>
  );
}
