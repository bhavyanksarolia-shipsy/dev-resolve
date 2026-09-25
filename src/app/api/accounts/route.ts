import { getAccounts } from "@/lib/config";
import { countsByAccount, DevrevError } from "@/lib/devrev";

/** Accounts from config + live counts (DevRev WMS Support view rules — see config devrev_view). */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const accounts = getAccounts();
  let counts: Record<string, { total: number; wms: number }> = {};
  let countsError: string | undefined;
  try {
    counts = await countsByAccount(accounts.map((a) => ({ key: a.slug, accountIds: a.devrev.account_ids })), force);
  } catch (e) {
    countsError = (e as DevrevError).message;
  }
  return Response.json({
    accounts: accounts.map(({ name, slug, status, group, devrev }) => ({
      name, slug, status, group, devrev_names: devrev.names, open_tickets: counts[slug]?.total ?? null, wms_tickets: counts[slug]?.wms ?? null,
    })),
    counts_error: countsError,
  });
}
