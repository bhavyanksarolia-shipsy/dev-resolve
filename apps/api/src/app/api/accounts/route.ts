import { ALL_CLIENTS, getAccounts, inTicketScope, ticketScope } from "@/lib/config";
import { countsByAccount, DevrevError, openTickets } from "@/lib/devrev";

/** Accounts from config + live counts (DevRev Support view rules — see config devrev_view). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const force = sp.get("refresh") === "1";
  // pods=A|B: the person's Pod scope — open counts then only count those Pods ("-" = tickets with no Pod).
  const pods = sp.get("pods") ? new Set(sp.get("pods")!.split("|").filter(Boolean)) : null;
  const accounts = getAccounts();
  let counts: Record<string, { total: number; wms: number }> = {};
  let countsError: string | undefined;
  let allOpen: number | null = null;
  try {
    // "All clients" is more than the sum of clients: it also has accounts not routed / not set up yet.
    allOpen = await allClientsOpen(pods, force).catch(() => null);
    // Every client is counted (inactive ones are listed under their own heading, not hidden).
    counts = await countsByAccount(accounts.map((a) => ({ key: a.slug, accountIds: a.devrev.account_ids })), force);
    // With a Pod scope the counts MUST be scoped — never fall back to all-Pod counts silently.
    if (pods) counts = await scopedCounts(accounts, pods, force).catch((e) => { countsError = (e as Error).message; return {}; });
  } catch (e) {
    countsError = (e as DevrevError).message;
  }
  return Response.json({
    accounts: accounts.map(({ name, slug, status, group, devrev, client_active }) => ({
      name, slug, status, group, devrev_names: devrev.names, client_active: client_active !== false,
      open_tickets: counts[slug]?.total ?? null, wms_tickets: counts[slug]?.wms ?? null,
    })),
    all_open: allOpen,
    counts_error: countsError,
  });
}

/** Open tickets under "All clients" (DevRev's whole Support view minus ignored test orgs), Pod scope applied. Cached 2 min. */
const allCache = new Map<string, { at: number; value: Promise<number> }>();
function allClientsOpen(pods: Set<string> | null, force: boolean) {
  const key = pods ? [...pods].sort().join("|") : "*";
  const hit = allCache.get(key);
  if (!force && hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.value;
  const scope = ticketScope(ALL_CLIENTS)!;
  const value = openTickets(scope.ids).then((rows) => inTicketScope(rows, scope).filter((w) => {
    if (!pods) return true;
    const p = typeof w.custom_fields?.tnt__pod === "string" ? w.custom_fields.tnt__pod : "";
    return pods.has(p || "-");
  }).length);
  value.catch(() => allCache.delete(key));
  allCache.set(key, { at: Date.now(), value });
  return value;
}

/** Per-client open counts within a Pod scope, from one listing of every open ticket (cached 2 min per scope). */
const scopedCache = new Map<string, { at: number; value: Promise<Record<string, { total: number; wms: number }>> }>();
function scopedCounts(accounts: ReturnType<typeof getAccounts>, pods: Set<string>, force: boolean) {
  const key = [...pods].sort().join("|");
  const hit = scopedCache.get(key);
  if (!force && hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.value;
  const value = (async () => {
    const ids = [...new Set(accounts.flatMap((a) => a.devrev.account_ids))];
    const open = await openTickets(ids);
    const out: Record<string, { total: number; wms: number }> = {};
    for (const a of accounts) {
      const mine = new Set(a.devrev.account_ids);
      const n = open.filter((w) => w.account?.id && mine.has(w.account.id)).filter((w) => {
        const p = typeof w.custom_fields?.tnt__pod === "string" ? w.custom_fields.tnt__pod : "";
        return pods.has(p || "-");
      }).length;
      out[a.slug] = { total: n, wms: 0 };
    }
    return out;
  })();
  value.catch(() => scopedCache.delete(key));
  scopedCache.set(key, { at: Date.now(), value });
  return value;
}
