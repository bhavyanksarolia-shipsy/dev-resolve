"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClientsTab } from "@/components/admin/ClientsTab";
import { ConnectionsTab } from "@/components/admin/ConnectionsTab";
import { FilesTab } from "@/components/admin/FilesTab";
import { UsersTab } from "@/components/admin/UsersTab";
import type { AdminConfig } from "@/components/admin/types";

const TABS = [["users", "User access control"], ["clients", "Clients"], ["connections", "Connections"], ["files", "Files & extension"]] as const;

export default function AdminPage() {
  return <Suspense><Admin /></Suspense>;
}

/** Everything an admin does, in the browser — no terminal. */
function Admin() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as (typeof TABS)[number][0]) || "users";
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fetch("/api/admin/config", { cache: "no-store" }).then(async (r) => (r.ok ? setCfg(await r.json()) : setError((await r.json()).error || `HTTP ${r.status}`)));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const go = (t: string) => router.replace(`/admin?tab=${t}`, { scroll: false });

  if (error) return <p className="text-sm text-bad">{error === "Admins only" ? "Only admins can open this page." : error}</p>;
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => go(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-accent font-medium text-accent-strong" : "border-transparent text-muted hover:text-fg"}`}>{l}</button>
        ))}
      </nav>
      {tab === "users" && <UsersTab />}
      {tab === "files" && <FilesTab />}
      {(tab === "clients" || tab === "connections") && !cfg && <div className="skeleton h-64 w-full rounded-xl" />}
      {tab === "clients" && cfg && <ClientsTab cfg={cfg} reload={reload} openConnections={() => go("connections")} />}
      {tab === "connections" && cfg && <ConnectionsTab cfg={cfg} reload={reload} />}
    </div>
  );
}
