import { useEffect, useState } from "react";
import { getLicenseState, subscribeLicense, signInWithGitHub, signOut, refreshLicense } from "../../lib/license";
import { SectionHeading } from "./shared";

const PLAN_LABELS: Record<string, string> = { free: "Free", pro: "Pro" };

export function AccountSection() {
  const [licenseState, setLicenseState] = useState(getLicenseState());
  useEffect(() => subscribeLicense(() => setLicenseState(getLicenseState())), []);

  const { session, license, loading, error } = licenseState;

  return (
    <div>
      <SectionHeading title="Account" desc="Sign in to unlock Relay Pro features. Everything else keeps working fully offline either way." />
      {!session ? (
        <button
          onClick={() => signInWithGitHub()}
          disabled={loading}
          className="flex items-center gap-2 px-3.5 py-2 rounded-md text-[13px] font-semibold bg-th-accent text-white hover:bg-th-accent-hover disabled:opacity-60 transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .3a12 12 0 00-3.8 23.38c.6.12.83-.26.83-.58v-2.02c-3.34.72-4.04-1.6-4.04-1.6-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.6-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .3z" />
          </svg>
          {loading ? "Waiting for browser…" : "Sign in with GitHub"}
        </button>
      ) : (
        <div className="flex flex-col gap-3 max-w-md">
          <div className="flex items-center justify-between bg-th-bg border border-th-border rounded-md px-3 py-2.5">
            <div>
              <p className="text-[13px] text-th-text-1 font-medium">{session.email ?? session.userId}</p>
              <p className="text-[11.5px] text-th-text-3 mt-0.5">
                Plan: <span className="font-mono">{PLAN_LABELS[license?.plan ?? "free"] ?? license?.plan ?? "Free"}</span>
                {license?.status && license.status !== "active" && <span className="text-amber-400"> · {license.status}</span>}
              </p>
            </div>
            <button onClick={() => signOut()} className="px-2.5 py-1 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4">
              Sign Out
            </button>
          </div>
          {license && license.features.length > 0 && (
            <div>
              <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5">Unlocked features</p>
              <div className="flex flex-wrap gap-1.5">
                {license.features.map((f) => (
                  <span key={f} className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-400/10 text-emerald-400">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => refreshLicense()}
            disabled={loading}
            className="self-start px-2.5 py-1 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4 disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh License"}
          </button>
        </div>
      )}
      {error && <p className="text-[11.5px] text-rose-400 mt-3">{error}</p>}
    </div>
  );
}
