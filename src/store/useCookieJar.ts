import { useEffect, useState } from "react";
import { StoredCookie } from "../types";
import { loadCookieJar, saveCookieJar } from "../lib/tauri";

// local-only, loaded per workspace dir, never part of the .relay files
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
