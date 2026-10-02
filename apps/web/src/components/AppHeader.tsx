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

  useEffect(() => {
    if (pathname === "/login") return;
    let live = true;
    fetch("/api/auth/me", { cache: "no-store" }).then(async (r) => {
      if (!live) return;
      if (r.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
      else if (r.ok) setMe(await r.json());
    }).catch(() => {});
    return () => { live = false; };
  }, [pathname, router]);

  const link = "rounded-md px-2.5 py-1 text-muted hover:bg-accent-soft hover:text-accent-strong";
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
            {me.isAdmin && <Link href="/settings" className={link}>Settings</Link>}
          </nav>
        )}
        {me && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <InvestigationNotifier />
            <SignOut user={me.user} />
          </div>
        )}
      </div>
    </header>
  );
}
