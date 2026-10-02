"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { describeCall, hidePaths, STEP_ICON, toolName } from "./labels";
import { notify } from "@/components/Dialog";

interface Step { seq: number; kind: string; tool: string | null; input: Record<string, unknown> | null; output: string | null; created_at: string }
interface ChatFile { id: number; name: string; type: string; size: number }
interface HistoryGroup { investigation_id: number; started: string; messages: Step[] }

const ACCEPT = "image/*,.pdf,.eml,.xlsx,.xls,.xlsm,.csv,.tsv,.ods,.docx,.txt,.log,.json,.xml,.html,.md,.yaml,.yml,.sql";
const MAX_FILES = 10, MAX_FILE = 20 * 1024 * 1024;
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImage = (t: string) => /^image\/(png|jpeg|gif|webp)$/.test(t);
const time = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The RCA's "## Summary" section, used as the agent's opening message in the chat. */
function summaryOf(rca: string | null) {
  if (!rca) return null;
  const m = rca.match(/##\s*Summary\s*\n([\s\S]*?)(\n##\s|$)/i);
  return (m ? m[1] : rca.slice(0, 700)).trim();
}

/**
 * Chat mode: the whole conversation with the agent about this ticket — earlier investigations' chats, the RCA it
 * wrote, and every follow-up — with a composer that takes text plus images, PDFs, emails, sheets and documents.
 */
export function ChatPanel({ invId, steps, busy, rca, rcaVersion, confidence, onSend, onOpenRca }: {
  invId: number; steps: Step[]; busy: boolean; rca: string | null; rcaVersion: number; confidence: string | null;
  onSend: (message: string, files: File[]) => Promise<boolean>; onOpenRca: () => void;
}) {
  const [history, setHistory] = useState<HistoryGroup[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [drag, setDrag] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/investigations/${invId}/history`).then((r) => (r.ok ? r.json() : { groups: [] })).then((d) => setHistory(d.groups ?? [])).catch(() => {});
  }, [invId]);

  const firstUser = steps.findIndex((s) => s.kind === "user_message");
  const thread = firstUser < 0 ? [] : steps.slice(firstUser).filter((s) =>
    s.kind === "user_message" || s.kind === "text" || s.kind === "tool_call" || (s.kind === "system" && s.output?.startsWith("Chat failed")));
  // Replies that arrive while this panel is open type themselves out; older ones show straight away.
  const [bornAfter] = useState(() => Math.max(-1, ...steps.map((s) => s.seq)));
  const scrollDown = useCallback(() => { end.current?.scrollIntoView({ block: "end" }); }, []);
  useEffect(scrollDown, [scrollDown, thread.length, busy, history.length]);
  const lastCall = busy ? [...thread].reverse().find((s) => s.kind === "tool_call") : undefined;
  // Once the agent has answered a message, keep only its reply (and a revised-RCA note) — the checks it ran and its
  // "let me look…" notes are only shown while it's still working on that message.
  const turns: Step[][] = [];
  for (const st of thread) (st.kind === "user_message" || !turns.length ? turns[turns.push([]) - 1] : turns[turns.length - 1]).push(st);
  const visible = turns.flatMap((t, i) => {
    const working = busy && i === turns.length - 1;
    if (working) return t;
    const [user, ...rest] = t;
    const reply = [...rest].reverse().find((x) => x.kind === "text" || x.kind === "system");
    const rca = rest.find((x) => x.kind === "tool_call" && toolName(x.tool) === "submit_rca");
    return [user, ...rest.filter((x) => x === reply || x === rca)];
  });

  function add(list: FileList | File[] | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { notify({ title: "File too large", message: `${f.name} is over 20 MB`, tone: "error" }); continue; }
      if (next.length >= MAX_FILES) { notify({ message: `Up to ${MAX_FILES} files per message`, tone: "error" }); break; }
      next.push(f);
    }
    setFiles(next);
  }

  async function submit() {
    const m = text.trim();
    if ((!m && !files.length) || sending || busy) return;
    setSending(true);
    if (await onSend(m, files)) { setText(""); setFiles([]); }
    setSending(false);
  }

  return (
    <div className="relative flex min-h-[60vh] flex-1 flex-col lg:min-h-0"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3 pr-1 text-sm">
        {history.map((g) => (
          <div key={g.investigation_id} className="space-y-3">
            <Divider>Earlier investigation #{g.investigation_id} · {time(g.started)}</Divider>
            {g.messages.map((s) => <Message key={`${g.investigation_id}-${s.seq}`} s={s} />)}
          </div>
        ))}
        {history.length > 0 && <Divider>This investigation</Divider>}

        <Bot>
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-strong">RCA v{rcaVersion}</span>
            {confidence && <span>confidence {confidence}</span>}
          </div>
          {summaryOf(rca) ? <Markdown compact>{hidePaths(summaryOf(rca))}</Markdown> : <p>The investigation is done.</p>}
          <p className="mt-2 text-muted">Ask me to check anything else: another trip or order, a time window, or attach a screenshot or file. If what I find changes the root cause, I&apos;ll write a new RCA version.</p>
          <button onClick={onOpenRca} className="mt-2 text-xs font-medium text-accent-strong hover:underline">Open the full RCA →</button>
        </Bot>

        {visible.map((s) => <Message key={s.seq} s={s} onOpenRca={onOpenRca} animate={s.seq > bornAfter} onTick={scrollDown} />)}
        {busy && (
          <div className="flex items-center gap-2 pl-1 text-xs text-muted">
            <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="ip-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>
            {lastCall ? `${describeCall(lastCall.tool, lastCall.input)}…` : "Dev Resolve is thinking…"}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="shrink-0 rounded-xl border border-line bg-panel p-2 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => <PendingFile key={`${f.name}-${i}`} f={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}
          </ul>
        )}
        <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          onPaste={(e) => { const imgs = Array.from(e.clipboardData.files); if (imgs.length) { e.preventDefault(); add(imgs.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type })))); } }}
          placeholder={busy ? "Waiting for the agent…" : "Ask a follow-up, add context, or paste a screenshot… (Enter to send)"}
          className="block max-h-48 min-h-[2.75rem] w-full resize-y bg-transparent px-2 py-1 text-sm outline-none disabled:opacity-60" />
        <div className="mt-1 flex items-center gap-2">
          <input ref={picker} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => picker.current?.click()} disabled={busy} title="Attach images, PDFs, emails, Excel, Word or text files"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-bg hover:text-fg disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
            Attach
          </button>
          <span className="hidden text-xs text-muted sm:inline">Images, PDF, email, Excel, Word, CSV, text · drag &amp; drop or paste</span>
          <button onClick={submit} disabled={busy || sending || (!text.trim() && !files.length)}
            className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50">
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {drag && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-semibold text-accent-strong">
          Drop files to attach them
        </div>
      )}
    </div>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 py-1 text-xs text-muted"><span className="h-px flex-1 bg-line" />{children}<span className="h-px flex-1 bg-line" /></div>;
}

function Bot({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-[11px] font-bold text-white">DR</span>
      <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-sm border px-4 py-3 ${error ? "border-red-200 bg-red-50 text-bad" : "border-line bg-panel"}`}>{children}</div>
    </div>
  );
}

/** Reveals a reply a few words at a time (about 2–3 s whatever its length), then shows the full Markdown. */
function Typewriter({ text, onTick }: { text: string; onTick?: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const step = Math.max(4, Math.ceil(text.length / 90));
    const t = setInterval(() => setN((x) => {
      if (x >= text.length) { clearInterval(t); return x; }
      const next = text.indexOf(" ", Math.min(text.length, x + step));
      return next < 0 ? text.length : next;
    }), 28);
    return () => clearInterval(t);
  }, [text]);
  useEffect(() => { onTick?.(); }, [n, onTick]);
  const done = n >= text.length;
  return (
    <div className="chat-reveal">
      <Markdown compact>{done ? text : text.slice(0, n)}</Markdown>
      {!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-middle" aria-hidden />}
    </div>
  );
}

function Message({ s, onOpenRca, animate, onTick }: { s: Step; onOpenRca?: () => void; animate?: boolean; onTick?: () => void }) {
  if (s.kind === "user_message") {
    const files = (s.input?.files as ChatFile[] | undefined) ?? [];
    return (
      <div className={`ml-auto flex max-w-[85%] flex-col items-end gap-1.5 ${animate ? "chat-pop" : ""}`}>
        <div className="text-xs text-muted"><b className="text-fg">{String(s.input?.by ?? "You")}</b> · {time(s.created_at)}</div>
        {files.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {files.map((f) => <SentFile key={f.id} f={f} />)}
          </div>
        )}
        {s.output && <div className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-accent px-4 py-2.5 text-white">{s.output}</div>}
      </div>
    );
  }
  if (s.kind === "tool_call") {
    if (toolName(s.tool) === "submit_rca") {
      return (
        <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent-strong">
          📝 Wrote a revised RCA draft
          {onOpenRca && <button onClick={onOpenRca} className="ml-auto underline">Open RCA</button>}
        </div>
      );
    }
    return <div className={`flex gap-2 pl-10 text-xs text-muted ${animate ? "chat-pop" : ""}`}><span>{STEP_ICON[toolName(s.tool)] ?? "•"}</span>{describeCall(s.tool, s.input)}</div>;
  }
  return (
    <div className={animate ? "chat-pop" : ""}>
      <Bot error={s.kind === "system"}>
        {animate && s.kind === "text" ? <Typewriter text={hidePaths(s.output)} onTick={onTick} /> : <Markdown compact>{hidePaths(s.output)}</Markdown>}
      </Bot>
    </div>
  );
}

function SentFile({ f }: { f: ChatFile }) {
  const url = `/api/chat-files/${f.id}`;
  if (isImage(f.type)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line bg-panel" title={f.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={f.name} className="h-28 w-auto max-w-[14rem] object-cover" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs hover:border-accent">
      <FileIcon name={f.name} /><span className="max-w-[12rem] truncate font-medium">{f.name}</span><span className="text-muted">{kb(f.size)}</span>
    </a>
  );
}

function PendingFile({ f, onRemove }: { f: File; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage(f.type) || f.size > 8_000_000) return;
    const r = new FileReader();
    r.onload = () => setPreview(String(r.result));
    r.readAsDataURL(f);
    return () => r.abort();
  }, [f]);
  return (
    <li className="group relative flex items-center gap-2 rounded-lg border border-line bg-bg py-1 pl-1 pr-7 text-xs">
      {preview
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={preview} alt="" className="h-9 w-9 rounded object-cover" />
        : <span className="grid h-9 w-9 place-items-center rounded bg-panel"><FileIcon name={f.name} /></span>}
      <span className="max-w-[10rem]"><span className="block truncate font-medium">{f.name}</span><span className="text-muted">{kb(f.size)}</span></span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${f.name}`} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-muted hover:text-bad">✕</button>
    </li>
  );
}

function FileIcon({ name }: { name: string }) {
  const e = name.toLowerCase().split(".").pop() ?? "";
  const [label, color] = e === "pdf" ? ["PDF", "text-bad"] : ["xlsx", "xls", "csv", "tsv", "ods", "xlsm"].includes(e) ? ["XLS", "text-accent-strong"]
    : e === "docx" ? ["DOC", "text-sky-700"] : e === "eml" ? ["EML", "text-warn"] : [e.slice(0, 3).toUpperCase() || "FILE", "text-muted"];
  return <span className={`text-[10px] font-bold ${color}`}>{label}</span>;
}
