import { useEffect, useState } from "react";
import { StoredCookie } from "../types";
import { loadCookieJar, saveCookieJar } from "../lib/tauri";

// Local-only cookie jar (see lib/cookies.ts) — loaded per workspace dir,
// never part of the .relay files themselves.
export function useCookieJar(workspaceDir: string | null) {
  const [cookies, setCookies] = useState<StoredCookie[]>([]);

  useEffect(() => {
    if (!workspaceDir) {
      setCookies([]);
      return;
    }
    loadCookieJar(workspaceDir)
      .then((raw) => setCookies(JSON.parse(raw)))
      .catch(() => setCookies([]));
  }, [workspaceDir]);

  useEffect(() => {
    if (!workspaceDir) return;
    saveCookieJar(workspaceDir, JSON.stringify(cookies)).catch(() => {});
  }, [cookies, workspaceDir]);

  return { cookies, setCookies };
}
