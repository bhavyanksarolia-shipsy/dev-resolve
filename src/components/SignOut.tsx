"use client";

export function SignOut({ user }: { user: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span>Signed in as <b className="text-fg">{user}</b></span>
      <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => (location.href = "/login"))} className="text-accent hover:underline">Sign out</button>
    </div>
  );
}
