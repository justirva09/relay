import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import appIcon from "../../assets/app-icon.png";
import pkg from "../../../package.json";
import { SectionHeading } from "./shared";

const WEBSITE_URL = "https://relay-landing-page-iota.vercel.app/";
const AUTHOR_URL = "https://www.linkedin.com/in/justirva/";

export function AboutSection() {
  const [version, setVersion] = useState<string | null>(pkg.version);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div>
      <SectionHeading title="About" />
      <div className="flex flex-col items-center text-center gap-1 py-4">
        <img src={appIcon} alt="Relay" className="w-16 h-16 rounded-2xl shadow-lg mb-2" />
        <span className="text-[15px] font-semibold text-th-text-1">Relay</span>
        <span className="text-[12px] font-mono text-th-text-3">Version {version || "—"}</span>
        <p className="text-[12.5px] text-th-text-2 mt-3 max-w-[320px]">
          Relay helps you build, test, and version-control HTTP and gRPC requests — faster.
        </p>
        <button onClick={() => open(WEBSITE_URL).catch(() => window.open(WEBSITE_URL, "_blank"))} className="text-[12.5px] text-th-accent-text hover:underline mt-3">
          Website
        </button>
        <span className="text-[11px] text-th-text-4 mt-4">Copyright © 2026 Relay. All rights reserved.</span>
        <button onClick={() => open(AUTHOR_URL).catch(() => window.open(AUTHOR_URL, "_blank"))} className="text-[11px] text-th-text-4 hover:text-th-accent-text hover:underline mt-1">
          Created by Justirva
        </button>
      </div>
    </div>
  );
}
