"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HealthBanner } from "./HealthBanner";
import { Markdown } from "./Markdown";
import { describeCall, fileLabel, hidePaths, resultSummary, scopeLabel, STEP_ICON, toolName } from "./labels";

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


export function Workspace({ ticketId }: { ticketId: string }) {
  const [data, setData] = useState<TicketData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invId, setInvId] = useState<number | null>(null);
  const [inv, setInv] = useState<Investigation | null>(null);
  const [trail, setTrail] = useState<{ id: number | null; steps: Step[] }>({ id: null, steps: [] });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rca, setRca] = useState("");
  const [rating, setRating] = useState(0);
  const [rcaMode, setRcaMode] = useState<"preview" | "edit">("preview");
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
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono font-semibold text-accent-strong">{t.display_id}</span>
          <span className="rounded-full bg-panel px-2 py-0.5 text-muted ring-1 ring-line">{t.stage?.display_name ?? t.stage?.name}</span>
          <span className="text-muted">{t.account?.display_name}</span>
        </div>
        <h1 className="mb-2 text-2xl font-semibold leading-tight tracking-tight">{t.title}</h1>
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <a href={data.devrev_url} target="_blank" rel="noreferrer" className="font-medium text-accent-strong hover:underline">Open in DevRev ↗</a>
          <span className="text-muted">
            Routed to{" "}
            {data.routing.kind === "account" ? <b className="text-fg">{data.routing.name}</b>
              : data.routing.kind === "ambiguous" ? <b className="text-warn">ambiguous — agent will pick from {data.routing.candidates?.join(", ")}</b>
              : <b className="text-bad">{data.routing.kind} — add this DevRev account to config/projects.json</b>}
          </span>
        </div>
        <HealthBanner account={data.routing.account} />
        {t.body && (
          <div className="card mb-5 p-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Summary</div>
            <Markdown>{t.body}</Markdown>
          </div>
        )}
        {data.attachments.length > 0 && <Attachments items={data.attachments} />}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Timeline · {data.timeline.length}</h2>
        <ol className="space-y-3">
          {data.timeline.slice().reverse().map((c, i) => (
            <CommentCard key={c.id} c={c} attachments={data.attachments.filter((a) => a.comment_id === c.id).length} defaultOpen={i === 0} />
          ))}
        </ol>
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
            <div className="text-muted">during “{describeCall(s.tool, null)}” — the agent was told this check did not happen.</div>
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
              <div className={`mb-3 rounded-xl border px-4 py-3 text-sm leading-relaxed ${CURRENT_STATUS[inv.case_draft.current_status]?.[1] ?? ""}`}>
                <b>Now: {CURRENT_STATUS[inv.case_draft.current_status]?.[0] ?? inv.case_draft.current_status}</b>
                {inv.case_draft.current_status_detail && <span className="text-fg"> — {hidePaths(inv.case_draft.current_status_detail)}</span>}
              </div>
            )}
            {!currentPosted && (
              <div className="mb-2 inline-flex rounded-lg border border-line bg-bg p-0.5 text-xs font-medium">
                {(["preview", "edit"] as const).map((m) => (
                  <button key={m} onClick={() => setRcaMode(m)}
                    className={`rounded-md px-3 py-1 capitalize ${rcaMode === m ? "bg-panel text-accent-strong shadow-sm" : "text-muted hover:text-fg"}`}>
                    {m === "edit" ? "Edit markdown" : "Preview"}
                  </button>
                ))}
              </div>
            )}
            {currentPosted || rcaMode === "preview" ? (
              <div className="max-h-[75vh] overflow-y-auto rounded-xl border border-line bg-panel px-5 py-4">
                <Markdown>{hidePaths(rca)}</Markdown>
              </div>
            ) : (
              <textarea value={rca} onChange={(e) => setRca(e.target.value)}
                className="h-[60vh] w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
            )}
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
            <h2 className="mb-2 font-semibold">Knowledge proposals <span className="text-sm font-normal text-muted">— accepted ones are added to this account&apos;s knowledge base</span></h2>
            <div className="space-y-2">
              {proposals.map((p) => <ProposalCard key={p.id} p={p} onDecide={decide} />)}
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <div>
            <h2 className="mb-2 font-semibold">Investigation trail</h2>
            <ol className="space-y-1.5 text-sm">
              {pairSteps(steps).map(({ s, result }) => <StepRow key={s.seq} s={s} result={result} />)}
              {running && <li className="animate-pulse text-muted">working…</li>}
            </ol>
          </div>
        )}
      </section>
      )}
    </div>
  );
}

/**
 * Parallel tool calls return their results later, in a batch. Attach each result to the earliest
 * still-unanswered call of the same tool so every step shows its own outcome.
 */
function pairSteps(steps: Step[]): { s: Step; result?: Step }[] {
  const out: { s: Step; result?: Step }[] = [];
  const open: { s: Step; result?: Step }[] = [];
  for (const st of steps) {
    if (st.kind === "tool_result" || st.kind === "connection_error") {
      const i = open.findIndex((o) => o.s.tool === st.tool);
      if (i >= 0) { open[i].result = st; open.splice(i, 1); continue; }
      out.push({ s: st }); // orphan result — still show it
      continue;
    }
    const item = { s: st };
    out.push(item);
    if (st.kind === "tool_call") open.push(item);
  }
  return out;
}

function StepRow({ s, result }: { s: Step; result?: Step }) {
  if (s.kind === "text") return <li className="rounded-xl border border-line bg-panel px-4 py-3"><Markdown compact>{hidePaths(s.output)}</Markdown></li>;
  if (s.kind === "user_message") return <li className="whitespace-pre-wrap rounded-xl border border-emerald-200 bg-accent-soft px-4 py-3 text-sm"><b className="text-xs text-accent-strong">{String(s.input?.by ?? "You")} (chat)</b><br />{s.output}</li>;
  if (s.kind === "system") return <li className="px-1 text-xs text-muted">— {s.output}</li>;
  const call = s.kind === "tool_call" ? s : null;
  const res = call ? result : s;
  const conn = res?.kind === "connection_error";
  const r = res ? resultSummary(res.tool, res.output) : null;
  return (
    <li className="px-1">
      {call && (
        <div className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 w-5 shrink-0 text-center">{STEP_ICON[toolName(call.tool)] ?? "•"}</span>
          <span className="text-fg">{describeCall(call.tool, call.input)}</span>
          {call && !res && <span className="text-xs text-muted">…</span>}
        </div>
      )}
      {res && (r?.summary || conn) && (
        <div className="ml-7 mt-1">
          {r?.showRaw || conn ? (
            <details className={`rounded-lg border px-3 py-1.5 ${conn ? "border-red-200 bg-red-50" : "border-line bg-bg"}`}>
              <summary className={`text-xs ${conn ? "text-bad" : "text-muted"}`}>{conn ? "Connection error — this check didn't run" : r?.summary} · show details</summary>
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{res.output}</pre>
            </details>
          ) : (
            <span className="text-xs text-muted">↳ {r?.summary}</span>
          )}
        </div>
      )}
    </li>
  );
}

function ProposalCard({ p, onDecide }: { p: Proposal; onDecide: (p: Proposal, a: "accept" | "reject", content?: string) => void }) {
  const [content, setContent] = useState(p.content);
  const [editing, setEditing] = useState(false);
  const statusStyle = p.status === "accepted" ? "bg-emerald-50 text-ok ring-emerald-200" : p.status === "rejected" ? "bg-red-50 text-bad ring-red-200" : "bg-amber-50 text-warn ring-amber-200";
  return (
    <div className="card p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">{fileLabel(p.file)}</span>
        <span className="text-xs text-muted">{scopeLabel(p.account_slug)}</span>
        {p.source === "human_edit" && <span className="text-xs text-warn">from your edits</span>}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${statusStyle}`}>{p.status}</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted"><b className="text-fg">Why:</b> {hidePaths(p.rationale)}</p>
      {p.status === "pending" && editing ? (
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          className="h-40 w-full rounded-lg border border-line bg-bg p-2 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
      ) : (
        <div className="rounded-lg border border-line bg-bg px-3 py-2"><Markdown compact>{hidePaths(p.status === "pending" ? content : p.content)}</Markdown></div>
      )}
      {p.status === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
          <button onClick={() => onDecide(p, "accept", content)} className="rounded-lg bg-accent px-3 py-1.5 text-white hover:bg-accent-strong">Accept{content !== p.content ? " edited" : ""}</button>
          <button onClick={() => onDecide(p, "reject")} className="rounded-lg border border-line px-3 py-1.5 text-bad hover:border-red-300">Reject</button>
          <button onClick={() => setEditing((e) => !e)} className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-fg">{editing ? "Done editing" : "Edit"}</button>
        </div>
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
              <div key={s.seq} className="flex gap-2 pl-1 text-xs text-muted"><span>{STEP_ICON[toolName(s.tool)] ?? "•"}</span>{describeCall(s.tool, s.input)}</div>
            ) : (
              <div key={s.seq} className={`mr-6 rounded-xl border px-4 py-3 ${s.kind === "system" ? "border-red-200 bg-red-50 text-bad" : "border-line bg-bg"}`}>
                <div className="mb-1 text-xs font-semibold text-muted">Dev Resolve</div>
                <Markdown compact>{hidePaths(s.output)}</Markdown>
              </div>
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

function CommentCard({ c, attachments, defaultOpen }: {
  c: TicketData["timeline"][number]; attachments: number; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const who = c.created_by?.display_name || c.created_by?.email || "unknown";
  const internal = c.visibility === "internal";
  const long = (c.body || "").length > 600;
  return (
    <li className="card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${internal ? "bg-amber-50 text-warn" : "bg-accent-soft text-accent-strong"}`}>
          {who.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{who}</span>
          <span className="block text-xs text-muted">{new Date(c.created_date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
        </span>
        {attachments > 0 && <span className="text-xs text-muted">📎 {attachments}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${internal ? "bg-amber-50 text-warn ring-amber-200" : "bg-accent-soft text-accent-strong ring-emerald-200"}`}>{c.visibility}</span>
        <span className={`text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className={`border-t border-line px-4 py-3 ${long ? "max-h-[32rem] overflow-y-auto" : ""}`}>
          {c.body?.trim() ? <Markdown compact>{hidePaths(c.body)}</Markdown> : <span className="text-sm text-muted">(no text)</span>}
        </div>
      )}
    </li>
  );
}
