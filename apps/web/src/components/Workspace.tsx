"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HealthBanner } from "./HealthBanner";
import { Markdown } from "./Markdown";
import { describeCall, fileLabel, hidePaths, resultSummary, scopeLabel, STEP_ICON, toolName } from "./labels";
import { confirmDialog, notify } from "@/components/Dialog";
import { InvestigationProgress } from "./InvestigationProgress";
import { ChatPanel } from "./ChatPanel";
import { TicketControls } from "./TicketActions";
import { EmptyState } from "./EmptyState";

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
  ticket: { id: string; display_id: string; title: string; body?: string; created_date: string; stage?: { display_name?: string; name?: string }; account?: { display_name?: string }; custom_fields?: Record<string, unknown> };
  timeline?: { id: string; body?: string; visibility?: string; created_date: string; created_by?: { display_name?: string; email?: string }; via_email?: { from: string; to: string; cc: string } }[];
  investigations: { id: number; status: string }[];
  attachments?: Attachment[];
  routing: { kind: string; account?: string; name?: string; candidates?: string[] };
  devrev_url: string;
}

interface Attachment {
  artifact_id: string; part?: number; name: string; type: string; size: number; comment_id: string;
  comment_date: string; visibility?: string; from?: string; kind: "image" | "email" | "file"; signature?: boolean; url: string;
}
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);


export function Workspace({ ticketId, onClose }: { ticketId: string; onClose?: () => void }) {
  const [data, setData] = useState<TicketData | null>(null);
  // notFound: DevRev says the id doesn't exist (typo / deleted) — shown as a friendly page, not a raw error.
  const [err, setErr] = useState<{ notFound: boolean; message: string } | null>(null);
  const [ticketReload, setTicketReload] = useState(0);
  const [invId, setInvId] = useState<number | null>(null);
  const [inv, setInv] = useState<Investigation | null>(null);
  const [trail, setTrail] = useState<{ id: number | null; steps: Step[] }>({ id: null, steps: [] });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [fullTrail, setFullTrail] = useState(false);
  const [mode, setMode] = useState<"rca" | "chat">("rca");
  const [rca, setRca] = useState("");
  const [rating, setRating] = useState(0);
  const [rcaMode, setRcaMode] = useState<"preview" | "edit">("preview");
  const [busy, setBusy] = useState(false);
  const cursor = useRef<{ id: number | null; seq: number }>({ id: null, seq: -1 });
  const steps = trail.id === invId ? trail.steps : [];

  // Two requests: the ticket itself (fast) shows the page at once; the conversation (DevRev is slow to list
  // comments and attachments) fills in when ready — the server caches it per ticket.
  const [conv, setConv] = useState<{ id: string; timeline: NonNullable<TicketData["timeline"]>; attachments: Attachment[] } | null>(null);
  useEffect(() => {
    fetch(`/api/tickets/${ticketId}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) {
        const msg = String(d.error ?? `HTTP ${r.status}`);
        return setErr({ notFound: r.status === 404 || /HTTP 40[04]|invalid_id|not_found/i.test(msg), message: `${d.tag ?? "Error"} (${d.connection ?? "?"}): ${msg}` });
      }
      setData(d);
      if (d.investigations[0]) setInvId((cur) => cur ?? d.investigations[0].id);
    });
    loadConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, ticketReload]);
  // fresh=true skips the server's cache (after posting a comment — DevRev may not bump the ticket's modified time).
  function loadConversation(fresh = false) {
    fetch(`/api/tickets/${ticketId}?part=conversation${fresh ? "&refresh=1" : ""}`, { cache: "no-store" }).then(async (r) => {
      const d = await r.json().catch(() => null);
      if (r.ok && d) setConv({ id: ticketId, timeline: d.timeline ?? [], attachments: d.attachments ?? [] });
    }).catch(() => {});
  }
  const timeline = conv?.id === ticketId ? conv.timeline : null;
  const attachments = conv?.id === ticketId ? conv.attachments : [];
  const router = useRouter();
  // Back (and Esc): to where you came from (inbox / dashboard, with its filters); the inbox if the ticket was opened directly.
  const close = () => {
    if (onClose) return onClose(); // shown as a sheet over the table
    const fromApp = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin);
    if (fromApp && window.history.length > 1) router.back(); else router.push("/tickets");
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

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
    setFullTrail(d.trail === "full");
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

  async function sendChat(message: string, files: File[] = []) {
    if (!inv) return false;
    let body: BodyInit = JSON.stringify({ message });
    if (files.length) {
      const form = new FormData();
      form.set("message", message);
      for (const f of files) form.append("files", f, f.name);
      body = form;
    }
    const r = await fetch(`/api/investigations/${inv.id}/chat`, { method: "POST", body });
    const d = await r.json().catch(() => ({ error: r.status === 413 ? "Files are too large — send fewer at a time" : `HTTP ${r.status}` }));
    if (!r.ok) { notify({ title: "Message not sent", message: d.error, tone: "error" }); return false; }
    setInv((p) => (p ? { ...p, chat_running: true } : p));
    setTimeout(poll, 500);
    return true;
  }

  async function start() {
    setBusy(true);
    const r = await fetch("/api/investigations", { method: "POST", body: JSON.stringify({ ticket: ticketId }) });
    window.dispatchEvent(new Event("investigations-changed")); // header count
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return notify({ title: "Investigation not started", message: d.error, tone: "error" });
    setRca("");
    setInvId(d.id);
  }

  async function post() {
    if (!inv) return;
    const again = !!inv.posted_at && inv.posted_version >= inv.rca_version;
    const ok = await confirmDialog({
      title: again ? `Post RCA v${inv.rca_version} again?` : inv.posted_at ? `Post RCA v${inv.rca_version} as an update?` : `Post RCA v${inv.rca_version}?`,
      message: again
        ? `It was already posted ${new Date(inv.posted_at!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. This adds it to ${ticketId}'s internal discussion once more (not visible to the customer), marked as superseding the earlier one.`
        : `It goes to ${ticketId}'s internal discussion in DevRev (not visible to the customer).`,
      confirmLabel: again ? "Post again" : inv.posted_at ? "Post update" : "Post RCA",
    });
    if (!ok) return;
    setBusy(true);
    const r = await fetch(`/api/investigations/${inv.id}/post`, { method: "POST", body: JSON.stringify({ rca, rating: rating || null, again }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return notify({ title: `Not posted${d.connection ? ` — ${d.connection}` : ""}`, message: `${d.tag ? `${d.tag}: ` : ""}${d.error}`, tone: "error" });
    notify({ message: `Posted to ${ticketId}'s internal discussion`, tone: "ok" });
    loadConversation(true); // show the new comment in the conversation
    poll();
  }

  async function decide(p: Proposal, action: "accept" | "reject", content?: string) {
    const r = await fetch(`/api/proposals/${p.id}`, { method: "POST", body: JSON.stringify({ action, content }) });
    if (!r.ok) notify({ title: `Couldn't ${action} the proposal`, message: (await r.json()).error, tone: "error" });
    poll();
  }

  if (err) {
    const back = (
      <button type="button" onClick={close} className="inline-flex items-center gap-1.5 rounded-lg bg-bad px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18 9 12l6-6" /></svg>
        Back
      </button>
    );
    return err.notFound
      ? <EmptyState title={`We couldn't find ${ticketId}`} text="DevRev has no ticket with this number. Check it for a typo — e.g. TKT-114620." action={back} />
      : (
        <EmptyState title={`${ticketId} didn't load`} text="DevRev didn't answer as expected — usually a hiccup; try again in a moment."
          action={<div className="space-y-3">
            <div className="flex justify-center gap-2">{back}
              <button type="button" onClick={() => { setErr(null); setTicketReload((n) => n + 1); }} className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-medium hover:border-accent">Try again</button>
            </div>
            <details className="mx-auto max-w-md text-left text-xs text-muted"><summary className="cursor-pointer text-center">Details</summary><p className="mt-1 break-words font-mono">{err.message}</p></details>
          </div>} />
      );
  }
  if (!data) return <WorkspaceSkeleton />;
  const t = data.ticket;
  const connErrors = steps.filter((s) => s.kind === "connection_error");
  const running = inv?.status === "running";
  const currentPosted = !!inv?.posted_at && inv.posted_version >= inv.rca_version;
  const canChat = !!inv && !running && !!inv.draft_rca;

  return (
    // Desktop: both columns fit the window and scroll on their own, so the page itself never scrolls.
    <div className={`relative grid gap-6 ${onClose ? "lg:h-[calc(100dvh-6.5rem)]" : "lg:h-[calc(100dvh-7.5rem)]"} lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
      {/* Left: ticket */}
      <section className="min-w-0 lg:overflow-y-auto lg:pr-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <button type="button" onClick={close} title="Back (Esc)"
            className="inline-flex items-center gap-1 rounded-md bg-bad px-2 py-0.5 font-semibold text-white shadow-sm transition hover:opacity-90">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18 9 12l6-6" /></svg>
            Back
          </button>
          <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono font-semibold text-accent-strong">{t.display_id}</span>
          <span>{data.routing.kind === "account" ? data.routing.name : t.account?.display_name}</span>
          <span aria-hidden>·</span>
          <a href={data.devrev_url} target="_blank" rel="noreferrer" className="font-medium text-accent-strong hover:underline">Open in DevRev ↗</a>
        </div>
        <h1 className="mb-3 text-xl font-semibold leading-snug tracking-tight">{t.title}</h1>
        {data.routing.kind !== "account" && (
          <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-warn ring-1 ring-amber-200">
            {data.routing.kind === "ambiguous" ? <>Client not certain — the agent will pick from {data.routing.candidates?.join(", ")}</>
              : <>{data.routing.kind}: this DevRev account isn&apos;t linked to a client yet (Admin → Clients)</>}
          </div>
        )}
        <div className="mb-3"><TicketControls ticket={t.display_id} onChanged={() => setTicketReload((n) => n + 1)} /></div>
        <HealthBanner account={data.routing.account} compact />
        {t.body && (
          <div className="card mb-5 p-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Summary</div>
            <Markdown>{t.body}</Markdown>
          </div>
        )}
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Conversation{timeline ? ` · ${timeline.length}` : ""}</h2>
        {!timeline && (
          <div className="space-y-2" aria-label="Loading the conversation">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-14 w-full rounded-xl" />)}
          </div>
        )}
        <ol className="space-y-2">
          {(timeline ?? []).slice().reverse().map((c, i) => (
            <CommentCard key={c.id} c={c} attachments={attachments.filter((a) => a.comment_id === c.id)}
              defaultOpen={i === 0 && c.visibility !== "internal" && (c.body || "").length < 1500} />
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
      <section className="flex min-w-0 flex-col lg:min-h-0">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {/* Follow-ups go through Chat (same investigation, keeps its findings); a fresh run is only for a first or failed one. */}
          {(!inv || inv.status === "failed") && (
            <button onClick={start} disabled={busy || running || data.routing.kind === "unmapped" || data.routing.kind === "ignored"}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {inv ? "Try again" : "Start investigation"}
            </button>
          )}
          {inv && (
            <span className="text-sm text-muted">
              #{inv.id} · <b className={running ? "text-warn" : inv.status === "failed" ? "text-bad" : "text-ok"}>{inv.status.replace("_", " ")}</b>
              {inv.confidence && <> · confidence {inv.confidence}</>}
              {inv.num_turns != null && <> · {inv.num_turns} turns</>}
            </span>
          )}
          {running && <button onClick={() => fetch(`/api/investigations/${inv!.id}`, { method: "DELETE" }).then(poll)} className="text-sm text-bad">cancel</button>}
          {canChat && (
            <div className="ml-auto inline-flex rounded-lg border border-line bg-bg p-0.5 text-sm font-medium" role="tablist">
              {([["rca", `RCA v${inv!.rca_version}`], ["chat", "Chat"]] as const).map(([m, l]) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 ${mode === m ? "bg-panel text-accent-strong shadow-sm" : "text-muted hover:text-fg"}`}>
                  {l}{m === "chat" && inv!.chat_running && <span className="ip-dot h-1.5 w-1.5 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
        {canChat && mode === "chat" ? (
          <ChatPanel invId={inv!.id} steps={steps} busy={!!inv!.chat_running} rca={inv!.draft_rca} rcaVersion={inv!.rca_version}
            confidence={inv!.confidence} onSend={sendChat} onOpenRca={() => setMode("rca")} />
        ) : (<>
        <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-2">
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
            {(
              <div className="mb-2 inline-flex rounded-lg border border-line bg-bg p-0.5 text-xs font-medium">
                {(["preview", "edit"] as const).map((m) => (
                  <button key={m} onClick={() => setRcaMode(m)}
                    className={`rounded-md px-3 py-1 capitalize ${rcaMode === m ? "bg-panel text-accent-strong shadow-sm" : "text-muted hover:text-fg"}`}>
                    {m === "edit" ? "Edit markdown" : "Preview"}
                  </button>
                ))}
              </div>
            )}
            {rcaMode === "preview" ? (
              <div className="rounded-xl border border-line bg-panel px-6 py-5">
                <Markdown>{hidePaths(rca)}</Markdown>
              </div>
            ) : (
              <textarea value={rca} onChange={(e) => setRca(e.target.value)}
                className="h-[85vh] min-h-[32rem] w-full rounded-xl border border-line bg-bg p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {!currentPosted && <>
                <span className="text-muted">Draft quality:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRating(n)} className={n <= rating ? "text-warn" : "text-muted"}>★</button>
                ))}
              </>}
              <button onClick={() => setMode("chat")} disabled={!canChat}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-accent px-3 py-1.5 font-medium text-accent-strong hover:bg-accent-soft disabled:opacity-50">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                Investigate more
              </button>
              <button onClick={post} disabled={busy} className="rounded-md bg-ok px-3 py-1.5 text-white disabled:opacity-50">
                {currentPosted ? "Post again to internal discussion" : inv.posted_at ? `Approve & post update (v${inv.rca_version})` : "Approve & post to internal discussion"}
              </button>
            </div>
          </div>
        )}

        {running && <div className="mb-5"><InvestigationProgress steps={steps} startedAt={steps[0]?.created_at} /></div>}

        {proposals.length > 0 && (
          <Collapsible className="mb-5" title="Knowledge proposals"
            hint={(() => { const n = proposals.filter((p) => p.status === "pending").length, a = proposals.filter((p) => p.status === "accepted").length;
              return [n && `${n} waiting for review`, a && `${a} added to the knowledge base`].filter(Boolean).join(" · "); })()}>
            <div className="space-y-2">
              {proposals.map((p) => <ProposalCard key={p.id} p={p} onDecide={decide} />)}
            </div>
          </Collapsible>
        )}

        {fullTrail && steps.length > 0 && (
          <Collapsible title="Investigation trail" hint={`${steps.filter((x) => x.kind === "tool_call").length} checks`}>
            <ol className="space-y-1.5 text-sm">
              {pairSteps(steps).map(({ s, result }) => <StepRow key={s.seq} s={s} result={result} />)}
              {running && <li className="animate-pulse text-muted">working…</li>}
            </ol>
          </Collapsible>
        )}
        </div>
        </>)}
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

/** One message's attachments: emails/files as links, images as tiles; email-signature logos behind a toggle. */
function AttachmentList({ items }: { items: Attachment[] }) {
  const [showLogos, setShowLogos] = useState(false);
  const logos = items.filter((a) => a.signature);
  const images = items.filter((a) => a.kind === "image" && (showLogos || !a.signature));
  const others = items.filter((a) => a.kind !== "image");
  return (
    <div className="text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Attachments · {items.length - logos.length}</div>
      {others.length > 0 && (
        <ul className="mb-2 space-y-1">
          {others.map((a) => (
            <li key={`${a.artifact_id}-${a.part ?? ""}`} className="flex min-w-0 items-center gap-2">
              <span>{a.kind === "email" ? "✉️" : "📄"}</span>
              <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">
                {a.kind === "email" ? "View email" : a.name}
              </a>
              <span className="shrink-0 text-xs text-muted">{a.kind === "email" ? a.name + " · " : ""}{kb(a.size)}</span>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a) => (
            <a key={`${a.artifact_id}-${a.part ?? ""}`} href={a.url} target="_blank" rel="noreferrer" title={a.name}
              className="group/img block overflow-hidden rounded-md border border-line bg-panel">
              {/* eslint-disable-next-line @next/next/no-img-element -- proxied, auth'd attachment; next/image can't optimise it */}
              <img src={a.url} alt={a.name} loading="lazy" className="h-28 w-full object-cover object-top transition group-hover/img:opacity-90" />
              <div className="truncate px-2 py-1 text-xs text-muted">{a.name} · {kb(a.size)}</div>
            </a>
          ))}
        </div>
      )}
      {logos.length > 0 && (
        <button type="button" onClick={() => setShowLogos((v) => !v)} className="text-xs text-muted hover:text-accent">
          {showLogos ? "Hide" : "Show"} {logos.length} signature logo{logos.length > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

/** Reviewer ↔ agent discussion on the RCA. Messages resume the investigation's agent session. */
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
  c: NonNullable<TicketData["timeline"]>[number]; attachments: Attachment[]; defaultOpen: boolean;
}) {
  const shown = attachments.filter((a) => !a.signature).length;
  const [open, setOpen] = useState(defaultOpen);
  const who = c.created_by?.display_name || c.created_by?.email || "unknown";
  const internal = c.visibility === "internal";
  // DevRev appends "<sub>don:identity:…:revu/… sent via Email</sub>" to imported emails — noise once the sender is shown.
  const body = (c.body || "").replace(/<sub>[\s\S]*?sent via Email\s*<\/sub>/gi, "").trim();
  const long = body.length > 600;
  // One-line gist for the closed card: plain text, no markdown marks, no email sign-off noise.
  const preview = hidePaths(body).replace(/<[^>]+>/g, " ").replace(/[#*_`>|\[\]()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return (
    <li className="card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-bg/60">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${internal ? "bg-amber-50 text-warn" : "bg-accent-soft text-accent-strong"}`}>
          {who.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{who}</span>
            <span className="shrink-0 text-xs text-muted">{new Date(c.created_date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
          </span>
          {c.via_email && <span className="block truncate text-[11px] text-muted" title={c.via_email.from}>via email{c.created_by?.email && c.created_by.email !== who ? ` · ${c.created_by.email}` : ""}</span>}
          {!open && preview && <span className="block truncate text-xs text-muted">{preview}</span>}
        </span>
        {shown > 0 && <span className="text-xs text-muted" title="Attachments on this message">📎 {shown}</span>}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${internal ? "bg-amber-50 text-warn" : "bg-accent-soft text-accent-strong"}`}>{internal ? "internal" : "external"}</span>
        <span className={`text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && c.via_email && (c.via_email.to || c.via_email.cc) && (
        <dl className="grid grid-cols-[3rem_1fr] gap-x-2 gap-y-0.5 border-t border-line bg-bg/50 px-4 py-2 text-[11px] text-muted">
          <dt>From</dt><dd className="break-words text-fg">{c.via_email.from}</dd>
          {c.via_email.to && <><dt>To</dt><dd className="break-words">{c.via_email.to}</dd></>}
          {c.via_email.cc && <><dt>Cc</dt><dd className="break-words">{c.via_email.cc}</dd></>}
        </dl>
      )}
      {open && (
        <div className={`border-t border-line px-4 py-3 ${long ? "max-h-[32rem] overflow-y-auto" : ""}`}>
          {body ? <Markdown compact>{hidePaths(body)}</Markdown> : <span className="text-sm text-muted">(no text)</span>}
        </div>
      )}
      {open && attachments.length > 0 && (
        <div className="border-t border-line bg-bg/60 px-4 py-3">
          <AttachmentList items={attachments} />
        </div>
      )}
    </li>
  );
}

/** A section that starts closed and opens on click. */
function Collapsible({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`card overflow-hidden ${className}`}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg">
        <span className={`text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        <span className="font-semibold">{title}</span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </button>
      {open && <div className="border-t border-line p-4">{children}</div>}
    </div>
  );
}
