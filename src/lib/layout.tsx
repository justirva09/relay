import React, { createContext, useContext, useEffect, useState } from "react";

export type ResponseLayout = "side" | "bottom";

interface LayoutCtx {
  responseLayout: ResponseLayout;
  setResponseLayout: (l: ResponseLayout) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  devToolsOpen: boolean;
  setDevToolsOpen: (open: boolean) => void;
}

const LayoutContext = createContext<LayoutCtx>({
  responseLayout: "side",
  setResponseLayout: () => {},
  sidebarCollapsed: false,
  toggleSidebar: () => {},
  devToolsOpen: false,
  setDevToolsOpen: () => {},
});

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [responseLayout, setResponseLayout] = useState<ResponseLayout>(
    () => (localStorage.getItem("relay-response-layout") as ResponseLayout) || "side"
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem("relay-sidebar-collapsed") === "true");
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("relay-response-layout", responseLayout);
  }, [responseLayout]);

  useEffect(() => {
    localStorage.setItem("relay-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const toggleSidebar = () => setSidebarCollapsed((c) => !c);

  return (
    <LayoutContext.Provider value={{ responseLayout, setResponseLayout, sidebarCollapsed, toggleSidebar, devToolsOpen, setDevToolsOpen }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  return useContext(LayoutContext);
}
