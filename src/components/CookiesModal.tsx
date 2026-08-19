import React, { useState } from "react";
import { StoredCookie, uid } from "../types";
import { useWorkspace } from "../store";

function formatExpiry(expires?: number): string {
  if (expires === undefined) return "Session";
  return new Date(expires).toLocaleString();
}

function CookieRow({ cookie, onUpdate, onRemove }: { cookie: StoredCookie; onUpdate: (patch: Partial<StoredCookie>) => void; onRemove: () => void }) {
  return (
    <tr className="border-b border-th-border last:border-0 hover:bg-th-hover">
      <td className="px-3 py-1.5 align-top">
        <input
          value={cookie.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="w-full bg-th-surface border border-th-border-input rounded-md px-2 py-1 text-[12.5px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
        />
      </td>
      <td className="px-3 py-1.5 align-top">
        <input
          value={cookie.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          className="w-full bg-th-surface border border-th-border-input rounded-md px-2 py-1 text-[12.5px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
        />
      </td>
      <td className="px-3 py-1.5 align-top">
        <input
          value={cookie.path}
          onChange={(e) => onUpdate({ path: e.target.value || "/" })}
          className="w-full bg-th-surface border border-th-border-input rounded-md px-2 py-1 text-[12.5px] font-mono text-th-text-1 focus:outline-none focus:border-th-border-focus"
        />
      </td>
      <td className="px-3 py-1.5 align-top text-[11.5px] font-mono text-th-text-3 whitespace-nowrap">{formatExpiry(cookie.expires)}</td>
      <td className="px-3 py-1.5 align-top">
        <div className="flex items-center gap-1.5">
          {cookie.secure && <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-400/10 text-emerald-400">Secure</span>}
          {cookie.httpOnly && <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-400/10 text-sky-400">HttpOnly</span>}
        </div>
      </td>
      <td className="px-3 py-1.5 align-top">
        <button onClick={onRemove} className="shrink-0 h-6 w-6 grid place-items-center rounded text-th-text-3 hover:text-rose-400 hover:bg-rose-400/10" aria-label="Remove cookie">
          ×
        </button>
      </td>
    </tr>
  );
}

export default function CookiesModal({ onClose }: { onClose: () => void }) {
  const { cookies, setCookies } = useWorkspace();
  const [newDomain, setNewDomain] = useState("");

  const byDomain = new Map<string, StoredCookie[]>();
  for (const c of cookies) {
    const list = byDomain.get(c.domain) ?? [];
    list.push(c);
    byDomain.set(c.domain, list);
  }
  const domains = Array.from(byDomain.keys()).sort();

  const updateCookie = (id: string, patch: Partial<StoredCookie>) => setCookies(cookies.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeCookie = (id: string) => setCookies(cookies.filter((c) => c.id !== id));

  const addDomain = () => {
    const domain = newDomain.trim().replace(/^https?:\/\//, "").split("/")[0];
    if (!domain) return;
    setCookies([...cookies, { id: uid(), domain, path: "/", name: "", value: "", secure: false, httpOnly: false }]);
    setNewDomain("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-th-overlay" onClick={onClose}>
      <div
        className="bg-th-surface border border-th-border rounded-lg shadow-2xl w-[760px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-th-text-1">Cookies</h2>
            <p className="text-[11.5px] text-th-text-3 mt-0.5">Local to this machine — automatically captured from responses, never saved into the workspace's committed files.</p>
          </div>
          <button onClick={onClose} className="text-th-text-3 hover:text-th-text-1 text-[18px] w-7 h-7 grid place-items-center rounded hover:bg-th-hover">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-3">
          {domains.length === 0 && <p className="text-[12.5px] text-th-text-4 font-mono py-6 text-center">No cookies yet — they'll show up here after a response sets one.</p>}
          {domains.map((domain) => (
            <div key={domain} className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[12px] font-mono font-semibold text-th-text-1">{domain}</p>
                <button
                  onClick={() => setCookies(cookies.filter((c) => c.domain !== domain))}
                  className="text-[11px] font-mono text-th-text-3 hover:text-rose-400"
                >
                  Clear domain
                </button>
              </div>
              <div className="overflow-x-auto border border-th-border rounded-md">
                <table className="w-full border-collapse text-[12.5px] font-mono">
                  <thead>
                    <tr className="border-b border-th-border">
                      <th className="text-left font-medium text-th-text-3 text-[10.5px] uppercase tracking-wide px-3 py-1.5 w-[20%]">Name</th>
                      <th className="text-left font-medium text-th-text-3 text-[10.5px] uppercase tracking-wide px-3 py-1.5 w-[28%]">Value</th>
                      <th className="text-left font-medium text-th-text-3 text-[10.5px] uppercase tracking-wide px-3 py-1.5 w-[14%]">Path</th>
                      <th className="text-left font-medium text-th-text-3 text-[10.5px] uppercase tracking-wide px-3 py-1.5">Expires</th>
                      <th className="text-left font-medium text-th-text-3 text-[10.5px] uppercase tracking-wide px-3 py-1.5">Flags</th>
                      <th className="w-8 px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {(byDomain.get(domain) ?? []).map((c) => (
                      <CookieRow key={c.id} cookie={c} onUpdate={(patch) => updateCookie(c.id, patch)} onRemove={() => removeCookie(c.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-th-border">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDomain()}
            placeholder="example.com"
            className="flex-1 bg-th-surface border border-th-border-input rounded-md px-2.5 py-1.5 text-[12.5px] font-mono text-th-text-1 placeholder:text-th-text-4 focus:outline-none focus:border-th-border-focus"
          />
          <button onClick={addDomain} className="px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-th-text-2 hover:text-th-text-1 hover:border-th-text-4">
            Add Domain
          </button>
          {cookies.length > 0 && (
            <button onClick={() => setCookies([])} className="ml-auto px-3 py-1.5 rounded-md text-[12.5px] font-mono border border-th-border-input text-rose-400 hover:bg-rose-400/10">
              Clear All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
