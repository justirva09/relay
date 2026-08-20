import { useCallback, useEffect, useRef, useState } from "react";
import { GrpcResponseSummary, ResponseState } from "../types";
import { loadResponseCache, saveResponseCache } from "../lib/tauri";

const RESPONSE_CACHE_SETTING_KEY = "relay-save-responses";

export type CachedResponse =
  | { kind: "http"; response: ResponseState }
  | { kind: "grpc"; lastResponse: GrpcResponseSummary };

export function useResponseCache(workspaceDir: string | null) {
  const [responseCacheEnabled, setResponseCacheEnabledState] = useState(() => localStorage.getItem(RESPONSE_CACHE_SETTING_KEY) !== "false");
  const responseCacheRef = useRef<Record<string, CachedResponse>>({});

  const setResponseCacheEnabled = useCallback((on: boolean) => {
    localStorage.setItem(RESPONSE_CACHE_SETTING_KEY, String(on));
    setResponseCacheEnabledState(on);
  }, []);

  const persistResponseCache = useCallback((dir: string) => {
    saveResponseCache(dir, JSON.stringify(responseCacheRef.current)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!workspaceDir) {
      responseCacheRef.current = {};
      return;
    }
    loadResponseCache(workspaceDir)
      .then((raw) => {
        responseCacheRef.current = JSON.parse(raw);
      })
      .catch(() => {
        responseCacheRef.current = {};
      });
  }, [workspaceDir]);

  return { responseCacheEnabled, setResponseCacheEnabled, responseCacheRef, persistResponseCache };
}
