import { requireAdmin } from "@/lib/adminGuard";
import { q } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/passwords";

/** User access control: list everyone; add / promote / demote / disable / enable / sign out / set a password. */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const users = await q(
    `SELECT u.name, u.email, u.display_name, u.is_admin, u.disabled_at, u.last_login_at, u.created_at, u.locked_until,
            u.password_hash IS NOT NULL AS has_password,
            (SELECT count(*)::int FROM app_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS sessions,
            (SELECT count(*)::int FROM investigations i WHERE i.started_by = u.name) AS investigations,
            (SELECT max(t.last_seen_at) FROM connector_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL) AS connector_seen
       FROM app_users u ORDER BY u.disabled_at NULLS FIRST, u.is_admin DESC, u.name`);
  return Response.json({ users, me: g.user.name });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { action?: string; name?: string; email?: string; admin?: boolean; password?: string };
  const name = (b.name || "").trim().toLowerCase();
  const self = name === g.user.name;
  const one = async (sql: string, params: unknown[]) => {
    const r = await q<{ name: string }>(sql + " RETURNING name", params);
    if (!r.length) throw new Error(`No user named "${name}"`);
  };
  try {
    switch (b.action) {
      case "add": {
        const email = (b.email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email");
        const base = email.split("@")[0].replace(/[^a-z0-9._-]/g, "-").slice(0, 60);
        const [taken] = await q(`SELECT 1 FROM app_users WHERE lower(email) = $1`, [email]);
        if (taken) throw new Error(`${email} already has a login`);
        let added: { name: string } | undefined;
        for (let i = 0; !added && i < 20; i++) {
          [added] = await q<{ name: string }>(`INSERT INTO app_users (name, email, is_admin) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING RETURNING name`,
            [i ? `${base}-${i + 1}` : base, email, !!b.admin]);
        }
        return Response.json({ ok: true, message: `Added ${email} as ${b.admin ? "admin" : "member"} — they sign in with Google` });
      }
      case "role":
        if (self && !b.admin) throw new Error("You can't remove your own admin role (ask another admin)");
        await one(`UPDATE app_users SET is_admin = $2 WHERE name = $1`, [name, !!b.admin]);
        return Response.json({ ok: true, message: `${name} is now ${b.admin ? "an admin" : "a member"}` });
      case "disable":
        if (self) throw new Error("You can't disable yourself");
        await one(`UPDATE app_users SET disabled_at = now() WHERE name = $1`, [name]);
        await q(`UPDATE app_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id = (SELECT id FROM app_users WHERE name = $1)`, [name]);
        await q(`UPDATE connector_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND user_id = (SELECT id FROM app_users WHERE name = $1)`, [name]);
        return Response.json({ ok: true, message: `${name} is disabled and signed out everywhere` });
      case "enable":
        await one(`UPDATE app_users SET disabled_at = NULL, failed_logins = 0, locked_until = NULL WHERE name = $1`, [name]);
        return Response.json({ ok: true, message: `${name} can sign in again` });
      case "signout": {
        const r = await q(`UPDATE app_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id = (SELECT id FROM app_users WHERE name = $1) RETURNING 1`, [name]);
        return Response.json({ ok: true, message: `Ended ${r.length} session(s) for ${name}${self ? " (including this one)" : ""}` });
      }
      case "set_password": {
        const problem = passwordProblem(b.password || "", name);
        if (problem) throw new Error(problem);
        await one(`UPDATE app_users SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE name = $1`,
          [name, await hashPassword(b.password!)]);
        return Response.json({ ok: true, message: `Password set for ${name}; their other sessions are signed out` });
      }
      default:
        throw new Error("Unknown action");
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
