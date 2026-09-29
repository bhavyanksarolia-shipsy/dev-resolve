"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}

function Login() {
  const next = useSearchParams().get("next") || "/";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ name, password }) });
    setBusy(false);
    if (!r.ok) return setError((await r.json()).error);
    location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-sm rounded-lg border border-line bg-panel p-5">
      <h1 className="mb-1 text-lg font-semibold">Sign in to Dev Resolve</h1>
      <p className="mb-4 text-sm text-muted">Ask the owner for a login.</p>
      <label className="mb-3 block text-sm">
        <div className="mb-1 text-muted">Name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" className="w-full rounded-md border border-line bg-bg px-2 py-1.5" />
      </label>
      <label className="mb-4 block text-sm">
        <div className="mb-1 text-muted">Password</div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full rounded-md border border-line bg-bg px-2 py-1.5" />
      </label>
      {error && <div className="mb-3 text-sm text-bad">{error}</div>}
      <button disabled={busy || !name || !password} className="w-full rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
