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
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-line bg-panel p-5">
      <h1 className="mb-1 text-lg font-semibold">Sign in to Dev Resolve</h1>
      <p className="mb-4 text-sm text-muted">{opts?.google ? "Use your work Google account." : "Ask the owner for a login."}</p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-bad ring-1 ring-red-200">{error}</div>}
      {!opts && <div className="skeleton h-9 w-full rounded-md" />}
      {opts?.google && (
        <a href={`/api/auth/google?next=${encodeURIComponent(next)}`}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-line bg-bg px-3 py-2 text-sm font-medium hover:border-accent">
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Sign in with Google
        </a>
      )}
      {opts?.google && opts.password && !showPassword && (
        <button type="button" onClick={() => setShowPassword(true)} className="mt-3 w-full text-center text-xs text-muted hover:text-accent">Use a name and password instead</button>
      )}
      {passwordForm && (
        <form onSubmit={submit} className={opts?.google ? "mt-4 border-t border-line pt-4" : ""}>
          <label className="mb-3 block text-sm">
            <div className="mb-1 text-muted">Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" className="w-full rounded-md border border-line bg-bg px-2 py-1.5" />
          </label>
          <label className="mb-4 block text-sm">
            <div className="mb-1 text-muted">Password</div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full rounded-md border border-line bg-bg px-2 py-1.5" />
          </label>
          <button disabled={busy || !name || !password} className="w-full rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      )}
    </div>
  );
}
