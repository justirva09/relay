import React from "react";
import { useTheme, LIGHT_THEMES, DARK_THEMES, ThemeId, AppearanceMode } from "../lib/theme";

function ModeButton({ mode, current, onClick, children, title }: { mode: AppearanceMode; current: AppearanceMode; onClick: () => void; children: React.ReactNode; title: string }) {
  const active = mode === current;
  return (
    <button
      title={title}
      onClick={onClick}
      className={`h-9 w-9 grid place-items-center rounded-md border transition-colors ${
        active ? "border-th-accent-border bg-th-accent-bg text-th-accent-text" : "border-th-border-input text-th-text-3 hover:text-th-text-1 hover:border-th-text-4"
      }`}
    >
      {children}
    </button>
  );
}

function ThemeColumn({ title, themes, activeId, isActiveColumn, onSelect }: {
  title: string;
  themes: { id: ThemeId; label: string }[];
  activeId: ThemeId;
  isActiveColumn: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[11px] font-mono uppercase tracking-wide text-th-text-4">{title}</span>
        {isActiveColumn && (
          <span className="text-[9.5px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-th-accent text-white">Active</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {themes.map((t) => {
          const selected = isActiveColumn && t.id === activeId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`flex items-center justify-between px-3 py-2 rounded-md text-[13px] text-left transition-colors ${
                selected ? "bg-th-accent-bg text-th-accent-text" : "text-th-text-2 hover:bg-th-hover hover:text-th-text-1"
              }`}
            >
              {t.label}
              {selected && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The actual picker UI, with no modal chrome of its own — reused both by
// the standalone ThemeModal (quick access from the toolbar icon) and the
// Settings window's "Appearance" section, so there's one source of truth
// for this instead of two copies drifting apart.
export function AppearanceSettings() {
  const { appearanceMode, setAppearanceMode, lightThemeId, darkThemeId, isDark, selectTheme } = useTheme();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <ModeButton mode="light" current={appearanceMode} onClick={() => setAppearanceMode("light")} title="Light">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        </ModeButton>
        <ModeButton mode="dark" current={appearanceMode} onClick={() => setAppearanceMode("dark")} title="Dark">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        </ModeButton>
        <ModeButton mode="system" current={appearanceMode} onClick={() => setAppearanceMode("system")} title="Follow system">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </ModeButton>
      </div>

      <div className="flex gap-5 border-t border-th-border pt-4">
        <ThemeColumn title="Light theme" themes={LIGHT_THEMES} activeId={lightThemeId} isActiveColumn={!isDark} onSelect={selectTheme} />
        <div className="w-px bg-th-border" />
        <ThemeColumn title="Dark theme" themes={DARK_THEMES} activeId={darkThemeId} isActiveColumn={isDark} onSelect={selectTheme} />
      </div>
    </div>
  );
}

export default function ThemeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[15px] font-semibold text-th-text-1">Appearance</h2>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <AppearanceSettings />
        </div>
      </div>
    </div>
  );
}
