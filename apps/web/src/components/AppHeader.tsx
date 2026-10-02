"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InvestigationNotifier } from "@/components/InvestigationNotifier";
import { SignOut } from "@/components/SignOut";

interface Me { user: string; isAdmin: boolean; connectorMode: boolean }

/** Top bar. Asks the backend who's signed in; anyone signed out is sent to /login (the backend guards all data anyway). */
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [down, setDown] = useState<string | null>(null);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/privacy") return;
    let live = true;
    fetch("/api/auth/me", { cache: "no-store" }).then(async (r) => {
      if (!live) return;
      setDown(null);
      if (r.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
      else if (r.ok) setMe(await r.json());
      // 5xx with a non-JSON body = the forwarding to the backend failed (wrong BACKEND_URL, backend down/redeploying).
      else if (r.status >= 500) setDown(`The backend isn't reachable (HTTP ${r.status}). If this lasts, check BACKEND_URL on Vercel and that the Railway service is running.`);
    }).catch(() => live && setDown("The backend isn't reachable — check your connection, BACKEND_URL on Vercel, and the Railway service."));
    return () => { live = false; };
  }, [pathname, router]);

  const link = "rounded-md px-2.5 py-1 text-muted hover:bg-accent-soft hover:text-accent-strong";
  if (pathname === "/login") return null; // the login page is full-screen with its own branding
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-panel/85 backdrop-blur">
      <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm text-white">DR</span>
          Dev Resolve
        </Link>
        {me && (
          <nav className="flex gap-1 text-sm">
            <Link href="/" className={link}>Tickets</Link>
            <Link href="/knowledge" className={link}>Knowledge</Link>
            {me.connectorMode && <Link href="/connector" className={link}>Connector</Link>}
            {me.isAdmin && <Link href="/admin" className={link}>Admin</Link>}
          </nav>
        )}
        {me && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <InvestigationNotifier />
            <SignOut user={me.user} />
          </div>
        )}
      </div>
      {down && <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-bad sm:px-6">{down}</div>}
    </header>
  );
}
