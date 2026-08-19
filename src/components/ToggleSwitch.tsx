import React from "react";

// Plain Tailwind spacing-scale track/knob (w-9/h-5 track, w-4/h-4 knob,
// translate-x-0/translate-x-4) — deliberately no arbitrary px math here.
// Hand-computed arbitrary values on a prior version of this toggle drifted
// out of sync with the actual rendered track width three separate times
// (WebKit's -webkit-appearance chrome, flex-shrink squeezing the track,
// and a plain off-by-2 in the translate distance) before landing on scale
// values, which sidestep all three failure modes at once.
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
