import React from "react";
import { useTheme, LIGHT_THEMES, DARK_THEMES, SYNTAX_PALETTES, ThemeId, AppearanceMode, SyntaxPalette } from "../lib/theme";

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

function ThemePreview({ id, syntaxPalette }: { id: ThemeId; syntaxPalette: SyntaxPalette }) {
  return (
    <div
      data-theme={id}
      data-syntax-palette={syntaxPalette}
      aria-hidden="true"
      className="h-[96px] overflow-hidden rounded-md border text-left"
      style={{ background: "var(--c-bg)", borderColor: "var(--c-border)", color: "var(--c-text-1)" }}
    >
      <div className="flex h-[16px] items-center gap-1 px-2 border-b" style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--c-accent)" }} />
        <span className="h-1 w-1 rounded-full" style={{ background: "var(--c-text-4)" }} />
        <span className="h-1 w-1 rounded-full" style={{ background: "var(--c-text-4)" }} />
        <span className="ml-auto h-1 w-7 rounded-full" style={{ background: "var(--c-text-4)" }} />
      </div>
      <div className="flex h-[80px]">
        <div className="w-[29%] shrink-0 border-r px-1.5 pt-2 space-y-2" style={{ background: "var(--c-sidebar)", borderColor: "var(--c-border)" }}>
          <div className="h-1.5 w-4/5 rounded-full" style={{ background: "var(--c-text-2)" }} />
          <div className="rounded-sm px-1 py-1" style={{ background: "var(--c-accent-bg)" }}>
            <div className="h-1 w-full rounded-full" style={{ background: "var(--c-accent-text)" }} />
          </div>
          <div className="h-1 w-3/5 rounded-full" style={{ background: "var(--c-text-3)" }} />
          <div className="h-1 w-4/5 rounded-full" style={{ background: "var(--c-text-3)" }} />
        </div>
        <div className="min-w-0 flex-1 px-2 pt-1.5">
          <div className="flex items-center gap-1 border-b pb-1" style={{ borderColor: "var(--c-border)" }}>
            <div className="h-1 w-8 rounded-full" style={{ background: "var(--c-text-2)" }} />
            <div className="h-1 w-5 rounded-full" style={{ background: "var(--c-text-4)" }} />
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <span className="rounded-sm px-1 py-[2px] text-[6px] font-bold leading-none" style={{ background: "var(--c-accent-bg)", color: "var(--c-accent-text)" }}>GET</span>
            <div className="h-2 flex-1 rounded-sm border" style={{ background: "var(--c-input)", borderColor: "var(--c-border-input)" }} />
            <div className="h-2 w-5 rounded-sm" style={{ background: "var(--c-accent)" }} />
          </div>
          <div className="mt-1.5 rounded-sm border px-1.5 py-1 font-mono text-[7px] leading-[1.35]" style={{ background: "var(--c-input)", borderColor: "var(--c-border-input)" }}>
            <div><span style={{ color: "var(--c-syn-key)" }}>"name"</span>: <span style={{ color: "var(--c-syn-string)" }}>"Relay"</span>,</div>
            <div><span style={{ color: "var(--c-syn-key)" }}>"port"</span>: <span style={{ color: "var(--c-syn-number)" }}>8080</span>,</div>
            <div><span style={{ color: "var(--c-syn-key)" }}>"ready"</span>: <span style={{ color: "var(--c-syn-bool)" }}>true</span>, <span style={{ color: "var(--c-syn-key)" }}>"error"</span>: <span style={{ color: "var(--c-syn-null)" }}>null</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeSection({ title, themes, activeId, syntaxPalette, isActiveSection, onSelect }: {
  title: string;
  themes: { id: ThemeId; label: string }[];
  activeId: ThemeId;
  syntaxPalette: SyntaxPalette;
  isActiveSection: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[12px] font-semibold text-th-text-2">{title}</h3>
        {isActiveSection && <span className="text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-th-accent-bg text-th-accent-text">Active</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {themes.map((t) => {
          const selected = isActiveSection && t.id === activeId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              aria-pressed={selected}
              aria-label={`Use ${t.label} theme`}
              className={`min-w-0 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-th-accent ${
                selected ? "border-th-accent bg-th-accent-bg" : "border-th-border-input hover:border-th-accent-border hover:bg-th-hover"
              }`}
            >
              <ThemePreview id={t.id} syntaxPalette={syntaxPalette} />
              <div className="flex items-center justify-between gap-1 mt-2 px-0.5">
                <span className={`min-w-0 truncate text-[11px] font-medium ${selected ? "text-th-accent-text" : "text-th-text-2"}`}>{t.label}</span>
                {selected && <svg className="shrink-0 text-th-accent-text" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The picker UI itself, no modal chrome. Reused by the standalone
// ThemeModal and Settings' Appearance section so there's one copy.
export function AppearanceSettings() {
  const { appearanceMode, setAppearanceMode, lightThemeId, darkThemeId, activeThemeId, syntaxPalette, setSyntaxPalette, isDark, selectTheme } = useTheme();

  return (
    <div className="flex flex-col gap-5">
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

      <div className="flex flex-col gap-6 border-t border-th-border pt-4">
        <ThemeSection title="Light themes" themes={LIGHT_THEMES} activeId={lightThemeId} syntaxPalette={syntaxPalette} isActiveSection={!isDark} onSelect={selectTheme} />
        <ThemeSection title="Dark themes" themes={DARK_THEMES} activeId={darkThemeId} syntaxPalette={syntaxPalette} isActiveSection={isDark} onSelect={selectTheme} />
        <div className="border-t border-th-border pt-4">
          <h3 className="mb-1 text-[12px] font-semibold text-th-text-2">Syntax colors</h3>
          <p className="mb-3 text-[11px] text-th-text-3">Choose code colors independently from the app theme.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SYNTAX_PALETTES.map((palette) => (
              <button key={palette.id} type="button" aria-pressed={syntaxPalette === palette.id} onClick={() => setSyntaxPalette(palette.id)}
                className={`min-w-0 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-th-accent ${syntaxPalette === palette.id ? "border-th-accent bg-th-accent-bg" : "border-th-border-input hover:border-th-accent-border"}`}>
                <div data-theme={activeThemeId} data-syntax-palette={palette.id} className="rounded border p-2 font-mono text-[10px] leading-4"
                  style={{ background: "var(--c-input)", borderColor: "var(--c-border-input)", color: "var(--c-text-1)" }}>
                  <div><span style={{ color: "var(--c-syn-key)" }}>"name"</span>: <span style={{ color: "var(--c-syn-string)" }}>"Relay"</span></div>
                  <div><span style={{ color: "var(--c-syn-key)" }}>"count"</span>: <span style={{ color: "var(--c-syn-number)" }}>42</span></div>
                  <div><span style={{ color: "var(--c-syn-bool)" }}>true</span> · <span style={{ color: "var(--c-syn-null)" }}>null</span></div>
                </div>
                <span className="mt-1.5 block truncate text-[11px] text-th-text-2">{palette.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ThemeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[700px] max-w-[calc(100vw-32px)] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
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
