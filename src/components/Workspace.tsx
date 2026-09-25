"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HealthBanner } from "./HealthBanner";

interface Step { seq: number; kind: string; tool: string | null; input: Record<string, unknown> | null; output: string | null; created_at: string }
interface Proposal { id: number; account_slug: string; file: string; content: string; rationale: string; source: string; status: string }
interface Investigation {
  id: number; status: string; error: string | null; draft_rca: string | null; final_rca: string | null;
  confidence: string | null; category: string | null; cost_usd: string | null; num_turns: number | null;
  account_slug: string; posted_at: string | null;
  rca_version: number; posted_version: number; chat_running: boolean; session_id: string | null;
  case_draft: { current_status?: string; current_status_detail?: string } | null;
}

const CURRENT_STATUS: Record<string, [string, string]> = {
  still_broken: ["Still broken", "text-bad border-bad/40 bg-bad/5"],
  resolved_manually: ["Fixed manually", "text-warn border-warn/40 bg-warn/5"],
  resolved_automatically: ["Recovered automatically", "text-ok border-ok/40 bg-ok/5"],
  partially_resolved: ["Partially fixed", "text-warn border-warn/40 bg-warn/5"],
  unknown: ["Current status unknown", "text-muted border-line"],
};
interface TicketData {
  ticket: { id: string; display_id: string; title: string; body?: string; created_date: string; stage?: { display_name?: string; name?: string }; account?: { display_name?: string } };
  timeline: { id: string; body?: string; visibility?: string; created_date: string; created_by?: { display_name?: string; email?: string } }[];
  investigations: { id: number; status: string }[];
  attachments: Attachment[];
  routing: { kind: string; account?: string; name?: string; candidates?: string[] };
  devrev_url: string;
}

interface Attachment {
  artifact_id: string; part?: number; name: string; type: string; size: number; comment_id: string;
  comment_date: string; visibility?: string; from?: string; kind: "image" | "email" | "file"; url: string;
}
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const short = (t: string | null) => (t ? t.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "") : "");

export function Workspace({ ticketId }: { ticketId: string }) {
  const [data, setData] = useState<TicketData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invId, setInvId] = useState<number | null>(null);
  const [inv, setInv] = useState<Investigation | null>(null);
  const [trail, setTrail] = useState<{ id: number | null; steps: Step[] }>({ id: null, steps: [] });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rca, setRca] = useState("");
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const cursor = useRef<{ id: number | null; seq: number }>({ id: null, seq: -1 });
  const steps = trail.id === invId ? trail.steps : [];

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) return setErr(`${d.tag ?? "Error"} (${d.connection ?? "?"}): ${d.error}`);
      setData(d);
      if (d.investigations[0]) setInvId(d.investigations[0].id);
    });
  }, [ticketId]);

  const poll = useCallback(async () => {
    if (!invId) return;
    if (cursor.current.id !== invId) cursor.current = { id: invId, seq: -1 };
    const after = cursor.current.seq;
    const r = await fetch(`/api/investigations/${invId}?after=${after}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) return;
    setInv((prev) => {
      const nx: Investigation = d.investigation;
      // Load the editor on first sight of a draft, and again whenever the agent submits a new version (chat revision).
      if (nx.draft_rca && (!prev?.draft_rca || prev.id !== nx.id || prev.rca_version !== nx.rca_version)) {
        const current = nx.posted_at && nx.posted_version >= nx.rca_version ? nx.final_rca || nx.draft_rca : nx.draft_rca;
        setRca(current);
      }
      return nx;
    });
    if (d.steps.length) cursor.current.seq = d.steps[d.steps.length - 1].seq;
    setTrail((t) => (t.id === invId && after >= 0 ? { id: invId, steps: [...t.steps, ...d.steps] } : { id: invId, steps: d.steps }));
    setProposals(d.proposals);
  }, [invId]);

  useEffect(() => {
    poll();
  }, [poll]);
  const agentBusy = inv?.status === "running" || !!inv?.chat_running;
  useEffect(() => {
    if (!agentBusy) return;
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [agentBusy, poll]);

  async function sendChat(message: string) {
    if (!inv) return false;
    const r = await fetch(`/api/investigations/${inv.id}/chat`, { method: "POST", body: JSON.stringify({ message }) });
    const d = await r.json();
    if (!r.ok) { alert(d.error); return false; }
    setInv((p) => (p ? { ...p, chat_running: true } : p));
    setTimeout(poll, 500);
    return true;
  }

  async function start() {
    setBusy(true);
    const r = await fetch("/api/investigations", { method: "POST", body: JSON.stringify({ ticket: ticketId }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(d.error);
    setRca("");
    setInvId(d.id);
  }

  async function post() {
    if (!inv || !confirm(`Post RCA v${inv.rca_version}${inv.posted_at ? " as an UPDATE" : ""} to ${ticketId}'s INTERNAL discussion?`)) return;
    setBusy(true);
    const r = await fetch(`/api/investigations/${inv.id}/post`, { method: "POST", body: JSON.stringify({ rca, rating: rating || null }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return alert(`${d.tag ?? "Error"} (${d.connection ?? "?"}): ${d.error}`);
    poll();
  }

  async function decide(p: Proposal, action: "accept" | "reject", content?: string) {
    const r = await fetch(`/api/proposals/${p.id}`, { method: "POST", body: JSON.stringify({ action, content }) });
    if (!r.ok) alert((await r.json()).error);
    poll();
  }

  if (err) return <div className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad">{err}</div>;
  if (!data) return <WorkspaceSkeleton />;
  const t = data.ticket;
  const connErrors = steps.filter((s) => s.kind === "connection_error");
  const running = inv?.status === "running";
  const currentPosted = !!inv?.posted_at && inv.posted_version >= inv.rca_version;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Left: ticket */}
      <section className="min-w-0">
        <div className="mb-1 font-mono text-sm text-muted">{t.display_id} · {t.stage?.display_name ?? t.stage?.name} · {t.account?.display_name}</div>
        <h1 className="mb-2 text-xl font-semibold">{t.title}</h1>
        <a href={data.devrev_url} target="_blank" rel="noreferrer" className="mb-3 inline-block text-sm text-accent hover:underline">Open {t.display_id} in DevRev ↗</a>
        <div className="mb-3 text-sm">
          Routed to:{" "}
          {data.routing.kind === "account" ? <b>{data.routing.name}</b>
            : data.routing.kind === "ambiguous" ? <b className="text-warn">ambiguous — agent will pick from {data.routing.candidates?.join(", ")}</b>
            : <b className="text-bad">{data.routing.kind} — add this DevRev account to config/projects.json</b>}
        </div>
        <HealthBanner account={data.routing.account} />
        {t.body && <p className="mb-4 whitespace-pre-wrap rounded-md border border-line bg-panel p-3 text-sm">{t.body}</p>}
        {data.attachments.length > 0 && <Attachments items={data.attachments} />}
        <h2 className="mb-2 text-sm font-semibold text-muted">Timeline ({data.timeline.length})</h2>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {data.timeline.slice().reverse().map((c) => (
            <details key={c.id} className="rounded-md border border-line bg-panel p-2 text-sm">
              <summary className="cursor-pointer text-muted">
                <span className={c.visibility === "internal" ? "text-warn" : "text-accent"}>{c.visibility}</span> · {c.created_by?.display_name || c.created_by?.email} · {new Date(c.created_date).toLocaleString("en-IN")}
                {(() => { const n = data.attachments.filter((a) => a.comment_id === c.id).length; return n ? <span className="ml-1">· 📎 {n}</span> : null; })()}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{c.body}</pre>
            </details>
          ))}
        </div>
      </section>

      {/* Right: investigation */}
      {invId && !inv ? (
        <section className="min-w-0 space-y-3">
          <div className="skeleton h-9 w-72 rounded-lg" />
          <div className="card space-y-2 p-4">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-4" style={{ width: `${96 - (i % 4) * 9}%` }} />)}</div>
        </section>
      ) : (
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button onClick={start} disabled={busy || running || data.routing.kind === "unmapped" || data.routing.kind === "ignored"}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {inv ? "Re-investigate" : "Start investigation"}
          </button>
          {inv && (
            <span className="text-sm text-muted">
              #{inv.id} · <b className={running ? "text-warn" : inv.status === "failed" ? "text-bad" : "text-ok"}>{inv.status.replace("_", " ")}</b>
              {inv.confidence && <> · confidence {inv.confidence}</>}
              {inv.num_turns != null && <> · {inv.num_turns} turns</>}
            </span>
          )}
          {running && <button onClick={() => fetch(`/api/investigations/${inv!.id}`, { method: "DELETE" }).then(poll)} className="text-sm text-bad">cancel</button>}
        </div>
        {inv?.error && <div className="mb-3 rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad">{inv.error}</div>}
        {connErrors.map((s) => (
          <div key={s.seq} className="mb-2 rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm">
            <b className="text-bad">{s.input?.tag === "VPN_REQUIRED" ? "Connect VPN" : s.input?.tag === "AUTH_FAILED" ? "Fix credentials" : "Not configured"}: {String(s.input?.connection)}</b>
            <div className="text-muted">during {short(s.tool)} — the agent was told this search did not happen.</div>
          </div>
        ))}

        {inv?.draft_rca && (
          <div className="card mb-5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">
                RCA <span className="text-sm font-normal text-muted">v{inv.rca_version}</span>{" "}
                {currentPosted
                  ? <span className="text-sm text-ok">· posted {new Date(inv.posted_at!).toLocaleString("en-IN")}</span>
                  : inv.posted_at
                    ? <span className="text-sm text-warn">· revised after posting v{inv.posted_version} — review &amp; post the update</span>
                    : <span className="text-sm text-muted">· draft, edit before posting</span>}
              </h2>
              {inv.category && <code className="text-xs text-muted">{inv.category}</code>}
            </div>
            {inv.case_draft?.current_status && (
              <div className={`mb-2 rounded-md border px-3 py-2 text-sm ${CURRENT_STATUS[inv.case_draft.current_status]?.[1] ?? ""}`}>
                <b>Now: {CURRENT_STATUS[inv.case_draft.current_status]?.[0] ?? inv.case_draft.current_status}</b>
                {inv.case_draft.current_status_detail && <span className="text-fg"> — {inv.case_draft.current_status_detail}</span>}
              </div>
            )}
            <textarea value={rca} onChange={(e) => setRca(e.target.value)} readOnly={currentPosted}
              className="h-[45vh] w-full rounded-md border border-line bg-bg p-2 font-mono text-xs" />
            {!currentPosted && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted">Draft quality:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRating(n)} className={n <= rating ? "text-warn" : "text-muted"}>★</button>
                ))}
                <button onClick={post} disabled={busy} className="ml-auto rounded-md bg-ok px-3 py-1.5 text-white disabled:opacity-50">
                  {inv.posted_at ? `Approve & post update (v${inv.rca_version})` : "Approve & post to internal discussion"}
                </button>
              </div>
            )}
          </div>
        )}

        {inv && !running && <Chat steps={steps} busy={!!inv.chat_running} onSend={sendChat} resumed={!!inv.session_id} />}

        {proposals.length > 0 && (
          <div className="mb-5">
            <h2 className="mb-2 font-semibold">Knowledge proposals <span className="text-sm font-normal text-muted">— accepted ones are saved to knowledge/{inv?.account_slug}/</span></h2>
            <div className="space-y-2">
              {proposals.map((p) => <ProposalCard key={p.id} p={p} onDecide={decide} />)}
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <div>
            <h2 className="mb-2 font-semibold">Investigation trail</h2>
            <ol className="space-y-1.5 text-sm">
              {steps.map((s) => <StepRow key={s.seq} s={s} />)}
              {running && <li className="animate-pulse text-muted">working…</li>}
            </ol>
          </div>
        )}
      </section>
      )}
    </div>
  );
}

function StepRow({ s }: { s: Step }) {
  if (s.kind === "text") return <li className="whitespace-pre-wrap rounded-md bg-panel p-2">{s.output}</li>;
  if (s.kind === "user_message") return <li className="whitespace-pre-wrap rounded-md border border-accent/40 bg-accent/10 p-2"><b className="text-xs text-accent">{String(s.input?.by ?? "You")} (chat)</b><br />{s.output}</li>;
  if (s.kind === "system") return <li className="text-xs text-muted">— {s.output}</li>;
  if (s.kind === "tool_call") {
    return (
      <li className="rounded-md border border-line bg-panel p-2">
        <span className="font-mono text-accent">{short(s.tool)}</span>
        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-muted">{JSON.stringify(s.input, null, 1)}</pre>
      </li>
    );
  }
  return (
    <li>
      <details className={`rounded-md border p-2 ${s.kind === "connection_error" ? "border-bad/40" : "border-line"}`}>
        <summary className="cursor-pointer text-xs text-muted">{s.kind === "connection_error" ? "connection error" : "result"} · {short(s.tool)} · {(s.output || "").length} chars</summary>
        <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{s.output}</pre>
      </details>
    </li>
  );
}

function ProposalCard({ p, onDecide }: { p: Proposal; onDecide: (p: Proposal, a: "accept" | "reject", content?: string) => void }) {
  const [content, setContent] = useState(p.content);
  return (
    <div className="rounded-md border border-line bg-panel p-2 text-sm">
      <div className="mb-1 flex items-center gap-2">
        <code className="text-xs">{p.account_slug}/{p.file}</code>
        {p.source === "human_edit" && <span className="text-xs text-warn">from your edits</span>}
        <span className={`ml-auto text-xs ${p.status === "accepted" ? "text-ok" : p.status === "rejected" ? "text-bad" : "text-muted"}`}>{p.status}</span>
      </div>
      <div className="mb-1 text-xs text-muted">{p.rationale}</div>
      {p.status === "pending" ? (
        <>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} className="h-28 w-full rounded border border-line bg-bg p-1.5 font-mono text-xs" />
          <div className="mt-1 flex gap-3">
            <button onClick={() => onDecide(p, "accept", content)} className="text-ok">Accept{content !== p.content ? " edited" : ""}</button>
            <button onClick={() => onDecide(p, "reject")} className="text-bad">Reject</button>
          </div>
        </>
      ) : (
        <pre className="whitespace-pre-wrap font-mono text-xs">{p.content}</pre>
      )}
    </div>
  );
}

function Attachments({ items }: { items: Attachment[] }) {
  const images = items.filter((a) => a.kind === "image");
  const others = items.filter((a) => a.kind !== "image");
  return (
    <div className="mb-4">
      <h2 className="mb-2 text-sm font-semibold text-muted">Attachments ({items.length})</h2>
      {images.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a) => (
            <a key={`${a.artifact_id}-${a.part ?? ""}`} href={a.url} target="_blank" rel="noreferrer" title={`${a.name} · ${a.from ?? ""}`}
              className="group block overflow-hidden rounded-md border border-line bg-panel">
              {/* eslint-disable-next-line @next/next/no-img-element -- proxied, auth'd attachment; next/image can't optimise it */}
              <img src={a.url} alt={a.name} loading="lazy" className="h-28 w-full object-cover object-top transition group-hover:opacity-90" />
              <div className="truncate px-2 py-1 text-xs text-muted">{a.name} · {kb(a.size)}</div>
            </a>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <ul className="space-y-1 text-sm">
          {others.map((a) => (
            <li key={`${a.artifact_id}-${a.part ?? ""}`} className="flex items-center gap-2">
              <span>{a.kind === "email" ? "✉️" : "📄"}</span>
              <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">
                {a.kind === "email" ? "View email" : a.name}
              </a>
              <span className="shrink-0 text-xs text-muted">{a.kind === "email" ? a.name + " · " : ""}{kb(a.size)} · {a.from} · {new Date(a.comment_date).toLocaleDateString("en-IN")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reviewer ↔ agent discussion on the RCA. Messages resume the investigation's agent session. */
function Chat({ steps, busy, onSend, resumed }: { steps: Step[]; busy: boolean; onSend: (m: string) => Promise<boolean>; resumed: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const firstUser = steps.findIndex((s) => s.kind === "user_message");
  const thread = firstUser < 0 ? [] : steps.slice(firstUser).filter((s) => s.kind === "user_message" || s.kind === "text" || s.kind === "tool_call" || (s.kind === "system" && s.output?.startsWith("Chat failed")));
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [thread.length, busy]);

  async function submit() {
    const m = text.trim();
    if (!m || sending || busy) return;
    setSending(true);
    if (await onSend(m)) setText("");
    setSending(false);
  }

  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-1 font-semibold">Discuss this RCA</h2>
      <p className="mb-2 text-xs text-muted">
        Ask questions or add context (&ldquo;also check trip SD39000220&rdquo;, &ldquo;SAP fixed this on 23-Sep, re-verify&rdquo;). The agent keeps
        {resumed ? " everything it checked in this investigation" : " the ticket + current RCA"}, can run new log / DB / code checks,
        and will post a revised draft (new version) above if the findings change.
      </p>
      {thread.length > 0 && (
        <div className="mb-2 max-h-[50vh] space-y-2 overflow-y-auto pr-1 text-sm">
          {thread.map((s) =>
            s.kind === "user_message" ? (
              <div key={s.seq} className="ml-10 whitespace-pre-wrap rounded-md bg-accent/10 px-3 py-2"><b className="text-xs text-accent">{String(s.input?.by ?? "You")}</b><br />{s.output}</div>
            ) : s.kind === "tool_call" ? (
              <div key={s.seq} className="font-mono text-xs text-muted">↳ {short(s.tool)} {JSON.stringify(s.input).slice(0, 120)}</div>
            ) : (
              <div key={s.seq} className={`mr-10 whitespace-pre-wrap rounded-md px-3 py-2 ${s.kind === "system" ? "bg-bad/5 text-bad" : "bg-bg"}`}><b className="text-xs text-muted">Dev Resolve</b><br />{s.output}</div>
            ),
          )}
          {busy && <div className="animate-pulse text-xs text-muted">Dev Resolve is checking…</div>}
          <div ref={end} />
        </div>
      )}
      <div className="flex gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={busy ? "Waiting for the agent…" : "Message Dev Resolve about this RCA… (Enter to send, Shift+Enter for a new line)"}
          className="h-16 flex-1 resize-y rounded-md border border-line bg-bg p-2 text-sm disabled:opacity-60" />
        <button onClick={submit} disabled={busy || sending || !text.trim()} className="self-end rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">Send</button>
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-3">
        <div className="skeleton h-4 w-56" /><div className="skeleton h-7 w-3/4" /><div className="skeleton h-4 w-40" />
        <div className="card space-y-2 p-4"><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-5/6" /><div className="skeleton h-4 w-2/3" /></div>
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-11 w-full rounded-xl" />)}
      </div>
      <div className="space-y-3">
        <div className="skeleton h-9 w-44 rounded-lg" />
        <div className="card space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-4" style={{ width: `${95 - i * 6}%` }} />)}</div>
      </div>
    </div>
  );
}
