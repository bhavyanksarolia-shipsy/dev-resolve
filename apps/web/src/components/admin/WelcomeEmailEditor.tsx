"use client";
import { useEffect, useRef, useState } from "react";
import { confirmDialog, toast } from "@/components/Dialog";
import { SlideSheet } from "@/components/SlideSheet";
import { btn, btnPrimary, input, post } from "./ui";

interface Step { title: string; time: string; tag?: string; text: string; sub?: string[]; button?: [string, string]; auto?: "connector" }
interface Tpl { theme?: string; subject: string; heading: string; subheading: string; intro: string; buttonLabel: string; stepsTitle: string; steps: Step[]; readyTitle: string; ready: string[]; needs: string; questions: string }

const area = `${input} min-h-[4.5rem] resize-y leading-relaxed`;
const label = "mb-1 block text-xs font-medium text-muted";

/**
 * Admin → Connections → Email → Edit email: every line of the welcome email, its steps (add / remove / reorder), and a
 * live preview of exactly what a new member receives. Saved on the server; "Reset to default" brings back the original.
 */
export function WelcomeEmailEditor({ onClose }: { onClose: () => void }) {
  const [t, setT] = useState<Tpl | null>(null);
  const [custom, setCustom] = useState(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [connector, setConnector] = useState<Step | null>(null);
  const [themes, setThemes] = useState<{ id: string; label: string; hero: string; heroImage: string; bar: string; accent: string; page: string }[]>([]);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<number | null>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    post<{ template: Tpl; custom: boolean; placeholders: Record<string, string>; connector: Step; themes: typeof themes }>("/api/admin/services", { service: "email", getTemplate: true })
      .then((r) => { if (r.template) { setT(r.template); setCustom(r.custom); setVars(r.placeholders); setConnector(r.connector); setThemes(r.themes ?? []); } else toast({ ok: false, text: r.error || "Couldn't load the email" }); });
  }, []);
  // Live preview, a moment after typing stops.
  useEffect(() => {
    if (!t) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await post<{ subject: string; html: string }>("/api/admin/services", { service: "email", previewTemplate: true, template: t, appUrl: window.location.origin });
      if (r.error) setProblem(r.error); else { setProblem(null); setPreview({ subject: r.subject, html: r.html }); }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [t]);

  if (!t) return <SlideSheet wide title="Welcome email" onClose={onClose}><div className="skeleton h-96 w-full rounded-2xl" /></SlideSheet>;
  const set = (p: Partial<Tpl>) => { setT({ ...t, ...p }); setDirty(true); };
  const setStep = (i: number, p: Partial<Step>) => set({ steps: t.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= t.steps.length) return;
    const steps = [...t.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    set({ steps }); setOpen(j);
  };
  const save = async () => {
    setBusy(true);
    const r = await post("/api/admin/services", { service: "email", saveTemplate: true, template: t });
    setBusy(false);
    toast({ ok: !r.error, text: r.error || r.message || "Saved" });
    if (!r.error) { setDirty(false); setCustom(true); }
  };
  const reset = async () => {
    const ok = await confirmDialog({ title: "Reset to the default email?", message: "Your changes to the welcome email are replaced with the original text and steps.", confirmLabel: "Reset", danger: true });
    if (!ok) return;
    const r = await post("/api/admin/services", { service: "email", resetTemplate: true });
    toast({ ok: !r.error, text: r.error || r.message || "Reset" });
    const d = await post<{ template: Tpl; custom: boolean }>("/api/admin/services", { service: "email", getTemplate: true });
    if (d.template) { setT(d.template); setCustom(d.custom); setDirty(false); }
  };
  // Asked by the drawer before it slides out (Esc, ←, the dimmed area) and by Cancel / Close.
  const okToLeave = async () => !dirty || confirmDialog({ title: "Leave without saving?", message: "Your changes to the welcome email will be lost.", confirmLabel: "Leave", danger: true });
  const close = async () => { if (await okToLeave()) onClose(); };
  // Keys pressed inside the preview stay in its frame — pass Esc on so the drawer still closes.
  const forwardEsc = (frame: HTMLIFrameElement) => {
    frame.contentDocument?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  };
  const field = (k: keyof Tpl, l: string, multi = false, ph = "") => (
    <label className="block"><span className={label}>{l}</span>
      {multi ? <textarea className={area} value={t[k] as string} placeholder={ph} onChange={(e) => set({ [k]: e.target.value })} />
        : <input className={input} value={t[k] as string} placeholder={ph} onChange={(e) => set({ [k]: e.target.value })} />}
    </label>
  );

  return (
    <SlideSheet wide title="Welcome email" beforeClose={okToLeave}
      subtitle={<>{custom ? "Customised" : "Default text"}{dirty && <span className="text-warn"> · unsaved changes</span>} — sent when you add someone with “Send a welcome email” ticked</>}
      onClose={onClose}>
      <div className="grid flex-1 gap-5 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Form */}
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Look</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {themes.map((th) => {
                const on = (t.theme ?? "clean") === th.id;
                return (
                  <button key={th.id} type="button" onClick={() => set({ theme: th.id })} aria-pressed={on}
                    className={`overflow-hidden rounded-xl border text-left transition ${on ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-accent"}`}>
                    {/* mini email: header, a line of text, a button */}
                    <div className="p-2" style={{ background: th.page }}>
                      <div className="h-6 rounded-t-md" style={{ background: th.heroImage !== "none" ? th.heroImage : th.hero, borderTop: th.bar ? `3px solid ${th.bar}` : undefined, boxShadow: th.bar ? "inset 0 0 0 1px #e3e8e5" : undefined }} />
                      <div className="space-y-1 rounded-b-md bg-white p-1.5">
                        <div className="h-1 w-4/5 rounded bg-gray-200" /><div className="h-1 w-3/5 rounded bg-gray-200" />
                        <div className="h-2 w-8 rounded-sm" style={{ background: th.accent }} />
                      </div>
                    </div>
                    <div className={`flex items-center justify-between px-2.5 py-1.5 text-xs font-medium ${on ? "text-accent-strong" : ""}`}>{th.label}{on && <span aria-hidden>✓</span>}</div>
                  </button>
                );
              })}
            </div>
            <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Top</h3>
            {field("subject", "Subject")}
            {field("heading", "Heading")}
            {field("subheading", "Under the heading")}
            {field("intro", "Introduction", true)}
            {field("buttonLabel", "Main button", false, "Open Dev Resolve")}
          </div>

          <div className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Steps · {t.steps.length}</h3>
              <input className={`${input} ml-auto max-w-56 py-1 text-xs`} value={t.stepsTitle} placeholder="Section title" title="Title above the steps" onChange={(e) => set({ stepsTitle: e.target.value })} />
            </div>
            <ol className="space-y-2">
              {t.steps.map((s, i) => (
                <li key={i} className="overflow-hidden rounded-xl border border-line bg-panel">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-white">{i + 1}</span>
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium" onClick={() => setOpen(open === i ? null : i)}>
                      <span className="truncate">{s.auto ? connector?.title ?? "Install the Connector" : s.title || <span className="text-muted">Untitled step</span>}</span>
                      {s.auto && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-strong">automatic</span>}
                    </button>
                    <button type="button" className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-bg disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">↑</button>
                    <button type="button" className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-bg disabled:opacity-30" disabled={i === t.steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down" title="Move down">↓</button>
                    <button type="button" className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-red-50 hover:text-bad disabled:opacity-30" disabled={t.steps.length === 1}
                      onClick={() => { set({ steps: t.steps.filter((_, j) => j !== i) }); setOpen(null); }} aria-label="Remove step" title="Remove step">✕</button>
                    <span className={`text-muted transition-transform ${open === i ? "rotate-90" : ""}`} aria-hidden>›</span>
                  </div>
                  {open === i && s.auto && (
                    <div className="space-y-2 border-t border-line bg-bg/60 p-3 text-sm">
                      <p>Written for you from <b>Admin → Files &amp; extension</b>, so it&apos;s always right:</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-muted">
                        <li><b className="text-fg">Chrome Web Store link set</b> → one <b className="text-fg">Add to Chrome</b> button</li>
                        <li><b className="text-fg">No link yet</b> → download, unzip, Developer mode, Load unpacked</li>
                      </ul>
                      <p className="rounded-lg bg-accent-soft/60 px-3 py-2 text-xs text-accent-strong">
                        Right now: {connector?.button?.[0] === "Add to Chrome" ? "the Web Store link is set — people get the Add to Chrome button." : "no Web Store link yet — people get the manual install steps."}
                      </p>
                      <button type="button" className={btn} onClick={() => connector && setStep(i, { ...connector, auto: undefined })}>Write this step myself instead</button>
                    </div>
                  )}
                  {open === i && !s.auto && (
                    <div className="grid gap-3 border-t border-line bg-bg/60 p-3 sm:grid-cols-[1fr_7rem_10rem]">
                      <label className="block"><span className={label}>Title</span><input className={input} value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} /></label>
                      <label className="block"><span className={label}>Time</span><input className={input} value={s.time} placeholder="2 min" onChange={(e) => setStep(i, { time: e.target.value })} /></label>
                      <label className="block"><span className={label}>Tag</span><input className={input} value={s.tag ?? ""} placeholder="once per laptop" onChange={(e) => setStep(i, { tag: e.target.value })} /></label>
                      <label className="block sm:col-span-3"><span className={label}>What to do</span><textarea className={area} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} /></label>
                      <label className="block sm:col-span-3"><span className={label}>Sub-steps — one per line (shown as a, b, c…)</span>
                        <textarea className={area} value={(s.sub ?? []).join("\n")} placeholder="Optional" onChange={(e) => setStep(i, { sub: e.target.value.split("\n") })} /></label>
                      <label className="block"><span className={label}>Button text</span><input className={input} value={s.button?.[0] ?? ""} placeholder="Optional" onChange={(e) => setStep(i, { button: [e.target.value, s.button?.[1] ?? ""] })} /></label>
                      <label className="block sm:col-span-2"><span className={label}>Button link</span><input className={`${input} font-mono text-xs`} value={s.button?.[1] ?? ""} placeholder="{app}/connector or https://…" onChange={(e) => setStep(i, { button: [s.button?.[0] ?? "", e.target.value] })} /></label>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <button type="button" className={`${btn} mt-3`} disabled={t.steps.length >= 12}
              onClick={() => { set({ steps: [...t.steps, { title: "New step", time: "", text: "" }] }); setOpen(t.steps.length); }}>+ Add a step</button>
            {!t.steps.some((s) => s.auto) && (
              <button type="button" className={`${btn} ml-2 mt-3`} disabled={t.steps.length >= 12}
                title="Install steps that follow the Chrome Web Store link in Admin → Files & extension"
                onClick={() => { set({ steps: [...t.steps, { title: "Install the Connector", time: "", text: "", auto: "connector" }] }); setOpen(t.steps.length); }}>+ Add the automatic Connector step</button>
            )}
          </div>

          <div className="card space-y-3 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Bottom</h3>
            {field("readyTitle", "Checklist title", false, "You're ready when")}
            <label className="block"><span className={label}>Checklist — one per line (shown with ✓)</span>
              <textarea className={area} value={t.ready.join("\n")} onChange={(e) => set({ ready: e.target.value.split("\n") })} /></label>
            {field("needs", "What they need", true)}
            {field("questions", "Questions line", true)}
          </div>

          <div className="card p-4 text-xs text-muted">
            <p className="mb-2 font-medium text-fg">Fill-ins and formatting</p>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {Object.entries(vars).map(([k, v]) => <div key={k}><code className="text-accent-strong">{k}</code> — {v}</div>)}
              <div><code className="text-accent-strong">**text**</code> — bold</div>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-ok" aria-hidden /><span className="font-semibold text-fg">Live preview</span>
              <span className="text-muted">as a new member “Asha Rao” would get it</span>
            </div>
            <div className="border-b border-line bg-bg px-4 py-2 text-sm"><span className="text-muted">Subject: </span><b>{preview?.subject ?? "…"}</b></div>
            {problem && <div className="border-b border-line bg-red-50 px-4 py-2 text-xs text-bad">{problem}</div>}
            {preview ? <iframe title="Email preview" srcDoc={preview.html} sandbox="allow-same-origin" onLoad={(e) => forwardEsc(e.currentTarget)} className="h-[calc(100vh-14rem)] w-full bg-white" />
              : <div className="skeleton h-[60vh] w-full" />}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap items-center gap-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button className={btnPrimary} disabled={busy || !dirty || !!problem} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button className={btn} onClick={close}>{dirty ? "Cancel" : "Close"}</button>
        {custom && <button className={`${btn} ml-auto text-bad`} onClick={reset}>Reset to default</button>}
      </div>
    </SlideSheet>
  );
}
