import React, { createContext, useContext, useEffect, useState } from "react";

export type ResponseLayout = "side" | "bottom";

interface LayoutCtx {
  responseLayout: ResponseLayout;
  setResponseLayout: (l: ResponseLayout) => void;
}

const LayoutContext = createContext<LayoutCtx>({ responseLayout: "side", setResponseLayout: () => {} });

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [responseLayout, setResponseLayout] = useState<ResponseLayout>(
    () => (localStorage.getItem("relay-response-layout") as ResponseLayout) || "side"
  );

  useEffect(() => {
    localStorage.setItem("relay-response-layout", responseLayout);
  }, [responseLayout]);

  return (
    <LayoutContext.Provider value={{ responseLayout, setResponseLayout }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  return useContext(LayoutContext);
}
