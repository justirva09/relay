import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeId =
  | "light"
  | "light-monochrome"
  | "light-pastel"
  | "catppuccin-latte"
  | "vscode-light"
  | "material-light"
  | "dark"
  | "dark-monochrome"
  | "dark-pastel"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | "nord"
  | "vscode-dark"
  | "material-dark";

export type AppearanceMode = "light" | "dark" | "system";

export const LIGHT_THEMES: { id: ThemeId; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "light-monochrome", label: "Light Monochrome" },
  { id: "light-pastel", label: "Light Pastel" },
  { id: "catppuccin-latte", label: "Catppuccin Latte" },
  { id: "vscode-light", label: "VS Code Light" },
  { id: "material-light", label: "Material Light" },
];

export const DARK_THEMES: { id: ThemeId; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "dark-monochrome", label: "Dark Monochrome" },
  { id: "dark-pastel", label: "Dark Pastel" },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { id: "nord", label: "Nord" },
  { id: "vscode-dark", label: "VS Code Dark" },
  { id: "material-dark", label: "Material Dark" },
];

const MODE_KEY = "relay-appearance-mode";
const LIGHT_KEY = "relay-theme-light";
const DARK_KEY = "relay-theme-dark";

function isDarkThemeId(id: string): boolean {
  return DARK_THEMES.some((t) => t.id === id);
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface ThemeCtx {
  appearanceMode: AppearanceMode;
  setAppearanceMode: (m: AppearanceMode) => void;
  lightThemeId: ThemeId;
  darkThemeId: ThemeId;
  activeThemeId: ThemeId;
  // not the same as appearanceMode === "dark", since "system" resolves to either
  isDark: boolean;
  selectTheme: (id: ThemeId) => void;
  // toolbar's quick toggle, swaps light/dark without opening the full picker
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  appearanceMode: "dark",
  setAppearanceMode: () => {},
  lightThemeId: "light",
  darkThemeId: "dark",
  activeThemeId: "dark",
  isDark: true,
  selectTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>(() => (localStorage.getItem(MODE_KEY) as AppearanceMode) || "dark");
  const [lightThemeId, setLightThemeId] = useState<ThemeId>(() => (localStorage.getItem(LIGHT_KEY) as ThemeId) || "light");
  const [darkThemeId, setDarkThemeId] = useState<ThemeId>(() => (localStorage.getItem(DARK_KEY) as ThemeId) || "dark");
  const [systemIsDark, setSystemIsDark] = useState(prefersDark);

  // only matters in "system" mode, keeps in sync if the OS setting changes mid-session
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const isDark = appearanceMode === "system" ? systemIsDark : appearanceMode === "dark";
  const activeThemeId = isDark ? darkThemeId : lightThemeId;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", activeThemeId);
  }, [activeThemeId]);

  const setAppearanceMode = (m: AppearanceMode) => {
    localStorage.setItem(MODE_KEY, m);
    setAppearanceModeState(m);
  };

  // picking a theme pins appearanceMode too, so it applies immediately instead of
  // silently saving a "for later" pref while system mode shows something else
  const selectTheme = (id: ThemeId) => {
    if (isDarkThemeId(id)) {
      setDarkThemeId(id);
      localStorage.setItem(DARK_KEY, id);
      setAppearanceMode("dark");
    } else {
      setLightThemeId(id);
      localStorage.setItem(LIGHT_KEY, id);
      setAppearanceMode("light");
    }
  };

  const toggleTheme = () => setAppearanceMode(isDark ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ appearanceMode, setAppearanceMode, lightThemeId, darkThemeId, activeThemeId, isDark, selectTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
