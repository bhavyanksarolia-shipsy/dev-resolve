import { requireAdmin } from "@/lib/adminGuard";
import { checkClaude, checkDevrev } from "@/lib/health";
import { whoAmI } from "@/lib/devrev";
import { q } from "@/lib/db";

/** Admin → Connections → Claude / DevRev: how each is signed in, whether it works, and recent usage. */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const [claude, devrev, me, [usage]] = await Promise.all([
    checkClaude(), checkDevrev(), whoAmI().catch(() => null),
    q<{ runs: number; cost: number; tokens: number }>(`SELECT count(*)::int runs, COALESCE(sum(cost_usd),0)::float cost,
       COALESCE(sum(input_tokens + output_tokens),0)::float tokens FROM agent_runs WHERE started_at > now() - interval '30 days'`),
  ]);
  return Response.json({
    claude: {
      ...claude,
      method: process.env.ANTHROPIC_API_KEY ? "API key (ANTHROPIC_API_KEY)" : process.env.CLAUDE_CODE_OAUTH_TOKEN ? "Claude login token (CLAUDE_CODE_OAUTH_TOKEN)" : "Local Claude Code login",
      model: process.env.DEV_RESOLVE_MODEL || "claude-opus-5-5",
      usage30: usage,
    },
    devrev: { ...devrev, as: me ? `${me.dev_user.display_name} <${me.dev_user.email}>` : null },
  });
}
