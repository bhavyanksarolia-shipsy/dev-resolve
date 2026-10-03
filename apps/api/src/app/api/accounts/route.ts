import { getAccounts } from "@/lib/config";
import { countsByAccount, DevrevError, openTickets } from "@/lib/devrev";

/** Accounts from config + live counts (DevRev Support view rules — see config devrev_view). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const force = sp.get("refresh") === "1";
  // pods=A|B: the person's Pod scope — open counts then only count those Pods + tickets with no Pod.
  const pods = sp.get("pods") ? new Set(sp.get("pods")!.split("|").filter(Boolean)) : null;
  const accounts = getAccounts();
  let counts: Record<string, { total: number; wms: number }> = {};
  let countsError: string | undefined;
  try {
    // Inactive clients are skipped: no DevRev count calls for them.
    counts = await countsByAccount(accounts.filter((a) => a.client_active !== false).map((a) => ({ key: a.slug, accountIds: a.devrev.account_ids })), force);
    if (pods) counts = await scopedCounts(accounts.filter((a) => a.client_active !== false), pods, force);
  } catch (e) {
    countsError = (e as DevrevError).message;
  }
  return Response.json({
    accounts: accounts.map(({ name, slug, status, group, devrev, client_active }) => ({
      name, slug, status, group, devrev_names: devrev.names, client_active: client_active !== false,
      open_tickets: counts[slug]?.total ?? null, wms_tickets: counts[slug]?.wms ?? null,
    })),
    counts_error: countsError,
  });
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
        return !p || pods.has(p);
      }).length;
      out[a.slug] = { total: n, wms: 0 };
    }
    return out;
  })();
  value.catch(() => scopedCache.delete(key));
  scopedCache.set(key, { at: Date.now(), value });
  return value;
}
