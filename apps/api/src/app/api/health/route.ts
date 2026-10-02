import { getAccount } from "@/lib/config";
import { checkAll } from "@/lib/health";
import { currentUser } from "@/lib/auth";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const account = sp.get("account") || undefined;
  if (account && getAccount(account)?.client_active === false) return Response.json({ checks: [], inactive: true });
  return Response.json({ checks: await checkAll({ accountSlug: account, force: sp.get("refresh") === "1", viewer: await currentUser(req) }) });
}
