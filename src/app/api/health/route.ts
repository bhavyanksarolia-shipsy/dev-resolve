import { checkAll } from "@/lib/health";

export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account") || undefined;
  return Response.json({ checks: await checkAll({ accountSlug: account }) });
}
