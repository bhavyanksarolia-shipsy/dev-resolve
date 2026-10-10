"use client";
import { useEffect, useState } from "react";

interface St {
  mode: boolean; online: boolean; vpn: Record<string, boolean>; vpnHosts: string[];
  vpns?: { id?: string; name: string; app: string; hosts: string[] }[];
  signins: { metabase: { project: string; label?: string; signedIn: boolean }[]; appLog: { label?: string; signedIn: boolean } | null };
}

/** What's not working for this person's connector, in words — empty when everything is connected. */
function issues(s: St): string[] {
  if (!s.online) return ["Chrome extension isn't running"];
  const vpns = s.vpns ?? [{ name: "Client VPN", app: "", hosts: s.vpnHosts }];
  return [
    // The company VPN (Pritunl, for Bifrost) is optional — Claude falls back without it — so it doesn't count here.
    ...vpns.filter((g) => g.id !== "company" && !g.hosts.every((h) => s.vpn[h])).map((g) => `${g.app || g.name} not connected`),
    ...(s.signins.appLog && !s.signins.appLog.signedIn ? [`${s.signins.appLog.label || "App logs"} — OpenSearch not signed in`] : []),
    ...s.signins.metabase.filter((m) => !m.signedIn).map((m) => `${m.label ?? m.project} — Metabase not signed in`),
  ];
}

/** The dot next to "Connector" in the header: green = all connected, grey = something needs attention (hover says what). */
export function ConnectorDot() {
  const [s, setS] = useState<St | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/connector/status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => live && d && setS(d)).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    // The Connector page polls every 5 s: take its answer straight away, so the dot never disagrees with the page.
    const fromPage = (e: Event) => live && setS((e as CustomEvent<St>).detail);
    window.addEventListener("focus", load);
    window.addEventListener("connector-status", fromPage);
    return () => { live = false; clearInterval(t); window.removeEventListener("focus", load); window.removeEventListener("connector-status", fromPage); };
  }, []);
  if (!s?.mode) return null; // local setups don't use the connector
  const list = issues(s);
  const ok = !list.length;
  const tip = ok ? "Connector: everything connected" : `Connector needs attention:\n• ${list.join("\n• ")}`;
  return <span role="img" aria-label={tip} title={tip} className={`ml-1.5 inline-block h-2 w-2 rounded-full align-middle ${ok ? "bg-ok" : "bg-muted/60"}`} />;
}
