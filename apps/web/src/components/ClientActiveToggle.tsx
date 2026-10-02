"use client";
import { useState } from "react";

/** On/off switch for "is this client still active with us". Saved in config/projects.json (who + when). */
export function ClientActiveToggle({ slug, name, initial, changed, onChanged }: { slug: string; name: string; initial: boolean; changed?: { by: string; at: string }; onChanged?: () => void }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function flip() {
    setBusy(true);
    setError(null);
    const next = !on;
    setOn(next);
    const r = await fetch(`/api/accounts/${slug}`, { method: "POST", body: JSON.stringify({ client_active: next }) });
    setBusy(false);
    if (!r.ok) { setOn(!next); setError((await r.json().catch(() => ({}))).error ?? "Couldn't save — try again"); return; }
    onChanged?.();
  }
  const title = changed ? `Last changed by ${changed.by}, ${new Date(changed.at).toLocaleString("en-IN")}` : "Default: active";
  return (
    <span className="inline-flex items-center gap-2">
    <button type="button" role="switch" aria-checked={on} aria-label={`${name} client active`} onClick={flip} disabled={busy} title={title}
      className="inline-flex items-center gap-2 disabled:opacity-60">
      <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span className={`text-xs font-medium ${on ? "text-accent-strong" : "text-muted"}`}>{on ? "Active" : "Inactive"}</span>
    </button>
    {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}
