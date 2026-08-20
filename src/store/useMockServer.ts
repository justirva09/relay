import { useCallback, useEffect, useState } from "react";
import {
  startMockServer as startMockServerTauri,
  stopMockServer as stopMockServerTauri,
  mockServerStatus as mockServerStatusTauri,
} from "../lib/tauri";

const MOCK_SERVER_PORT_KEY = "relay-mock-server-port";

export function useMockServer(workspaceDir: string | null) {
  const [mockServerPort, setMockServerPort] = useState<number>(() => Number(localStorage.getItem(MOCK_SERVER_PORT_KEY)) || 4010);
  const [mockServerRunningPort, setMockServerRunningPort] = useState<number | null>(null);
  const [mockServerError, setMockServerError] = useState<string | null>(null);

  const setMockServerPortPersisted = useCallback((port: number) => {
    localStorage.setItem(MOCK_SERVER_PORT_KEY, String(port));
    setMockServerPort(port);
  }, []);

  const toggleMockServer = useCallback(async () => {
    setMockServerError(null);
    try {
      if (mockServerRunningPort) {
        await stopMockServerTauri();
        setMockServerRunningPort(null);
        return;
      }
      if (!workspaceDir) {
        setMockServerError("Save this workspace to a folder first.");
        return;
      }
      await startMockServerTauri(workspaceDir, mockServerPort);
      setMockServerRunningPort(mockServerPort);
    } catch (e: any) {
      setMockServerError(e?.message || String(e));
    }
  }, [mockServerRunningPort, mockServerPort, workspaceDir]);

  useEffect(() => {
    mockServerStatusTauri().then(setMockServerRunningPort).catch(() => {});
  }, []);

  return {
    mockServerPort,
    setMockServerPort: setMockServerPortPersisted,
    mockServerRunningPort,
    mockServerError,
    toggleMockServer,
  };
}
