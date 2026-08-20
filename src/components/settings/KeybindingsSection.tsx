import { useEffect, useState } from "react";
import {
  KEYBINDING_DEFS,
  getEffectiveCombo,
  setCombo,
  resetCombo,
  resetAllCombos,
  subscribeKeybindings,
  comboFromEvent,
  comboToChips,
  actionForCombo,
  isCustomized,
} from "../../lib/keybindings";
import { SectionHeading } from "./shared";

function KeyChip({ text }: { text: string }) {
  return (
    <span className="min-w-[22px] px-1.5 py-0.5 rounded border border-th-border-input bg-th-bg text-[11px] font-mono text-th-text-2 text-center">
      {text}
    </span>
  );
}

function KeybindingRow({ def, recordingId, onStartRecord }: {
  def: (typeof KEYBINDING_DEFS)[number];
  recordingId: string | null;
  onStartRecord: (id: string | null) => void;
}) {
  const [, forceRerender] = useState(0);
  useEffect(() => subscribeKeybindings(() => forceRerender((n) => n + 1)), []);

  const combo = getEffectiveCombo(def.id);
  const recording = recordingId === def.id;
  const customized = isCustomized(def.id);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        onStartRecord(null);
        return;
      }
      const next = comboFromEvent(e);
      if (!next || ["mod", "shift", "alt"].includes(next)) return;
      setCombo(def.id, next);
      onStartRecord(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, def.id, onStartRecord]);

  const conflictId = combo ? actionForCombo(combo) : null;
  const conflictLabel = conflictId && conflictId !== def.id ? KEYBINDING_DEFS.find((d) => d.id === conflictId)?.label : null;

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-th-hover group">
      <span className="text-[13px] text-th-text-2">{def.label}</span>
      <div className="flex items-center gap-2">
        {conflictLabel && (
          <span className="text-[10.5px] text-amber-400" title={`Also used by "${conflictLabel}"`}>
            conflicts
          </span>
        )}
        <button
          onClick={() => onStartRecord(recording ? null : def.id)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-mono min-w-[90px] justify-center transition-colors ${
            recording ? "border-th-accent-border bg-th-accent-bg text-th-accent-text" : "border-th-border-input hover:border-th-text-4"
          }`}
        >
          {recording ? (
            <span className="text-th-text-3">Press keys…</span>
          ) : combo ? (
            comboToChips(combo).map((c, i) => <KeyChip key={i} text={c} />)
          ) : (
            <span className="text-th-text-4">Unassigned</span>
          )}
        </button>
        {customized && (
          <button onClick={() => resetCombo(def.id)} title="Reset to default" className="text-th-text-4 hover:text-th-text-1 text-[13px] w-6 h-6 grid place-items-center rounded hover:bg-th-hover opacity-0 group-hover:opacity-100">
            ↺
          </button>
        )}
      </div>
    </div>
  );
}

export function KeybindingsSection() {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const categories = Array.from(new Set(KEYBINDING_DEFS.map((d) => d.category)));

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <SectionHeading title="Keybindings" desc="Click a shortcut to record a new combo, or press Escape to cancel." />
        <button onClick={() => resetAllCombos()} className="shrink-0 px-3 py-1.5 rounded-md text-[12px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4 mt-[-8px]">
          Reset All
        </button>
      </div>
      <div className="flex flex-col gap-5">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-[11px] font-mono text-th-text-3 uppercase tracking-wide mb-1.5 px-3">{cat}</p>
            <div className="flex flex-col gap-0.5">
              {KEYBINDING_DEFS.filter((d) => d.category === cat).map((def) => (
                <KeybindingRow key={def.id} def={def} recordingId={recordingId} onStartRecord={setRecordingId} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
