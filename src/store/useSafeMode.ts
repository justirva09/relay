import { useCallback, useEffect, useState } from "react";

const SAFE_MODE_KEY_PREFIX = "relay-safe-mode:";

// Deliberately keyed by workspace dir and stored ONLY in localStorage — never
// inside the workspace's own committed files. This is a local trust decision
// about scripts from a collection someone else authored; if it were stored
// in the workspace itself, the collection's author could just ship
// safeMode: false in the file and silently disable the protection for
// everyone who opens it. Defaults to Safe Mode ON for every workspace,
// including one with no dir yet (the in-memory/demo case).
function safeModeKey(dir: string | null): string {
  return SAFE_MODE_KEY_PREFIX + (dir || "__no_dir__");
}

export function useSafeMode(workspaceDir: string | null) {
  const [safeMode, setSafeModeState] = useState<boolean>(() => localStorage.getItem(safeModeKey(null)) !== "false");

  // Reloads this specific workspace's own Safe Mode preference whenever the
  // open workspace changes — each workspace dir gets an independent local
  // trust decision, not a single global toggle that'd otherwise leak
  // whatever was last set into a workspace opened later.
  useEffect(() => {
    setSafeModeState(localStorage.getItem(safeModeKey(workspaceDir)) !== "false");
  }, [workspaceDir]);

  const setSafeMode = useCallback(
    (on: boolean) => {
      localStorage.setItem(safeModeKey(workspaceDir), String(on));
      setSafeModeState(on);
    },
    [workspaceDir]
  );

  return { safeMode, setSafeMode };
}
