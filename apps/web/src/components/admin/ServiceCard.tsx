"use client";
import { useEffect, useState } from "react";
import { btn } from "./ui";

interface Svc { status: string; message: string; fix?: string; host?: string }
interface Data {
  claude: Svc & { method: string; model: string; usage30: { runs: number; cost: number; tokens: number } };
  devrev: Svc & { as: string | null };
}
let cache: Promise<Data | null> | null = null;
const load = (force = false) => {
  if (force || !cache) cache = fetch("/api/admin/services", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache;
};

function Status({ s }: { s: Svc }) {
  const ok = s.status === "ok";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-accent-soft text-accent-strong" : s.status === "not_configured" ? "bg-amber-50 text-warn" : "bg-red-50 text-bad"}`}>
      {ok ? "connected" : s.status === "not_configured" ? "not set up" : "not working"}
    </span>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>;
}

/** Claude or DevRev: read-only status card (keys are set on the server — Railway variables). */
export function ServiceCard({ which }: { which: "claude" | "devrev" }) {
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; load().then((x) => live && setD(x)); return () => { live = false; }; }, []);
  const recheck = async () => { setBusy(true); setD(await load(true)); setBusy(false); };
  if (d === undefined) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!d) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the status.</div>;
  const s = which === "claude" ? d.claude : d.devrev;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="font-semibold">{which === "claude" ? "Claude — investigation agent" : "DevRev — tickets & comments"}</h3>
        <Status s={s} />
        <button className={`${btn} ml-auto`} disabled={busy} onClick={recheck}>{busy ? "Checking…" : "Re-check"}</button>
      </div>
      <dl className="divide-y divide-line">
        {which === "claude" ? <>
          <Row k="Signed in with" v={d.claude.method} />
          <Row k="Model" v={<code className="text-xs">{d.claude.model}</code>} />
          <Row k="Status" v={d.claude.message} />
          <Row k="Last 30 days" v={`${d.claude.usage30.runs} agent runs · $${d.claude.usage30.cost.toFixed(2)} · ${Math.round(d.claude.usage30.tokens / 1000).toLocaleString("en-IN")}k tokens`} />
        </> : <>
          <Row k="Acting as" v={d.devrev.as ?? "—"} />
          <Row k="Status" v={d.devrev.message} />
          <Row k="Used for" v="Reading tickets, conversations and attachments; posting internal RCAs; Stage / Pod / Part / owner / resolve updates" />
        </>}
        {s.fix && <Row k="To fix" v={<span className="text-warn">{s.fix}</span>} />}
      </dl>
      <p className="mt-3 text-xs text-muted">
        {which === "claude"
          ? "The key is set on the server (Railway variable ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN; model via DEV_RESOLVE_MODEL)."
          : "The token is set on the server (Railway variable DEVREV_TOKEN). Posts and updates appear in DevRev as this user."}
      </p>
    </section>
  );
}
