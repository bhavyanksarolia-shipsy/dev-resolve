"use client";
import { LogoutIcon } from "@/components/icons";

/** Who's signed in (username) and a sign-out icon. */
export function SignOut({ user }: { user: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold uppercase text-accent-strong" aria-hidden>{user.replace(/[^a-z0-9]/gi, "").slice(0, 2)}</span>
      <span className="hidden font-medium sm:inline">{user}</span>
      <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => window.location.assign("/login"))}
        title="Sign out" aria-label="Sign out" className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-bad">
        <LogoutIcon />
      </button>
    </div>
  );
}
