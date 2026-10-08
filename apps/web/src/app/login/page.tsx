"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}

function Login() {
  const params = useSearchParams();
  const nextRaw = params.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const [opts, setOpts] = useState<{ google: boolean; password: boolean } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/options").then((r) => r.json()).then(setOpts).catch(() => setOpts({ google: false, password: true }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ name, password }) });
    setBusy(false);
    if (!r.ok) return setError((await r.json()).error);
    window.location.assign(next);
  }

  const passwordForm = opts?.password && (!opts.google || showPassword);
  const field = "w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:bg-panel focus:ring-2 focus:ring-accent-soft";
  return (
    // Full screen (the app header is hidden on this page): brand panel + sign-in card.
    <div className="-mx-4 -my-6 grid min-h-screen grid-rows-[auto_1fr] sm:-mx-6 lg:grid-cols-[1.1fr_1fr] lg:grid-rows-1">
      <aside className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0f5132] via-[#15803d] to-[#22a35a] px-8 py-8 text-white max-lg:py-5 lg:px-14 lg:py-12">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-base font-bold text-[#15803d] shadow-sm">DR</span>
          <span className="text-lg font-semibold tracking-tight">Dev Resolve</span>
        </div>
        <div className="relative my-10 hidden max-w-md lg:block">
          <h2 className="text-3xl font-semibold leading-tight">Evidence-based RCAs for every support ticket.</h2>
          <ul className="mt-8 space-y-4 text-sm text-white/90">
            {[
              ["Investigates for you", "Reads the ticket, emails and attachments, then searches logs, the database and the code."],
              ["Says where things stand", "Every RCA includes the current state of the data — still broken or already fixed."],
              ["You stay in control", "Review, edit or chat with the draft; it's posted only to DevRev's internal discussion."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20 text-xs">✓</span>
                <span><b className="block text-white">{t}</b>{d}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative hidden text-xs text-white/60 lg:block">Only people added by a Dev Resolve admin can sign in.</p>
      </aside>

      <main className="flex items-start justify-center bg-bg px-6 py-10 lg:items-center lg:py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">{opts?.google ? "Sign in with your work Google account." : "Sign in with the login your admin gave you."}</p>

          {!error && params.get("ended") && <div role="status" className="mt-5 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-warn ring-1 ring-amber-200">You were signed out — no activity for 12 hours (or your session was ended). Sign in again to continue.</div>}
          {error && <div role="alert" className="mt-5 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-bad ring-1 ring-red-200">{error}</div>}

          <div className="mt-6 space-y-3">
            {!opts && <div className="skeleton h-11 w-full rounded-lg" />}
            {opts?.google && (
              <a href={`/api/auth/google?next=${encodeURIComponent(next)}`}
                className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-medium shadow-sm transition hover:border-accent hover:shadow">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                Sign in with Google
              </a>
            )}
            {opts?.google && opts.password && !showPassword && (
              <button type="button" onClick={() => setShowPassword(true)} className="w-full py-1 text-center text-xs text-muted hover:text-accent-strong">Use a username and password instead</button>
            )}
          </div>

          {passwordForm && (
            <form onSubmit={submit} className={`space-y-4 ${opts?.google ? "mt-5 border-t border-line pt-5" : "mt-6"}`}>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Username</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" className={field} />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={field} />
              </label>
              <button disabled={busy || !name || !password} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-strong disabled:opacity-50">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          <p className="mt-10 text-center text-xs text-muted">
            Trouble signing in? Ask your Dev Resolve admin. · <a href="/privacy" className="hover:text-accent-strong">Privacy</a>
          </p>
        </div>
      </main>
    </div>
  );
}
