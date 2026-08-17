import React, { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import appIcon from "../assets/app-icon.png";
import { checkVersionStatus } from "../lib/tauri";

const WEBSITE_URL = "https://relay-landing-page-iota.vercel.app/";

export default function VersionGate({ children }: { children: React.ReactNode }) {
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  useEffect(() => {
    checkVersionStatus()
      .then((status) => {
        if (status.blocked) setBlockedMessage(status.message);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      {children}
      {blockedMessage && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-th-bg">
          <div className="flex flex-col items-center text-center max-w-[360px] px-6">
            <img src={appIcon} alt="Relay" className="w-16 h-16 rounded-2xl shadow-lg mb-4" />
            <h2 className="text-[16px] font-semibold text-th-text-1 mb-2">This version is no longer supported</h2>
            <p className="text-[13px] text-th-text-2 mb-6">{blockedMessage}</p>
            <button
              onClick={() => open(WEBSITE_URL).catch(() => window.open(WEBSITE_URL, "_blank"))}
              className="px-4 py-2 rounded-md text-[13px] bg-th-accent text-white hover:bg-th-accent-hover"
            >
              Download Latest
            </button>
          </div>
        </div>
      )}
    </>
  );
}
