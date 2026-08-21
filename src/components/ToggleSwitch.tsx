import React from "react";

// plain Tailwind spacing-scale track/knob, no arbitrary px math on purpose.
// a prior version used hand-computed px values and drifted out of sync with
// the rendered track width three times (WebKit's -webkit-appearance chrome,
// flex-shrink squeezing the track, an off-by-2 in the translate distance).
// scale values sidestep all three
export default function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  const track = (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-label={label}
      className={`appearance-none relative inline-block shrink-0 w-9 h-5 rounded-full border-0 transition-colors ${checked ? "bg-th-accent" : "bg-th-border-input"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
  if (!label) return track;
  return (
    <label className="flex items-center gap-1.5 text-[11.5px] text-th-text-3 cursor-pointer select-none">
      {label}
      {track}
    </label>
  );
}
