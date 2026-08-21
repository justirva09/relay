import { useCallback, useEffect, useState } from "react";

const SAFE_MODE_KEY_PREFIX = "relay-safe-mode:";

// keyed by workspace dir, stored only in localStorage, never in the workspace's
// own committed files. this is a local trust decision about scripts from a
// collection someone else wrote. if it lived in the workspace file, the
// collection author could just ship safeMode: false and silently disable the
// protection for everyone who opens it. defaults to on for every workspace,
// including the no-dir/demo case.
function safeModeKey(dir: string | null): string {
  return SAFE_MODE_KEY_PREFIX + (dir || "__no_dir__");
}

export function useSafeMode(workspaceDir: string | null) {
  const [safeMode, setSafeModeState] = useState<boolean>(() => localStorage.getItem(safeModeKey(null)) !== "false");

  // reloads this workspace's own Safe Mode preference on workspace change, each
  // dir gets an independent trust decision instead of one global toggle leaking
  // into whatever workspace opens next
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
