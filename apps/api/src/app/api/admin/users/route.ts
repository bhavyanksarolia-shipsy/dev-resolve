import { requireAdmin } from "@/lib/adminGuard";
import { LIVE_SESSION_SQL, sessionIdleMs } from "@/lib/auth";
import { q } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/passwords";
import { rmSync } from "node:fs";
import { connectorStatus, userAuthDir } from "@/lib/connector";
import { adminSetting } from "@/lib/config";
import { mailSettings, sendMail, welcomeEmail } from "@/lib/mail";

/** User access control: list everyone; add / promote / demote / disable / enable / sign out / set a password. */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const users = await q(
    `SELECT u.name, u.email, u.display_name, u.is_admin, u.disabled_at, u.last_login_at, u.created_at, u.locked_until,
            u.password_hash IS NOT NULL AS has_password,
            -- Same rule as sign-in: not ended, under 7 days old, and used in the last 12 h.
            (SELECT count(*)::int FROM app_sessions s WHERE s.user_id = u.id AND ${LIVE_SESSION_SQL("$1")}) AS sessions,
            (SELECT max(s.last_seen_at) FROM app_sessions s WHERE s.user_id = u.id) AS last_active_at,
            (SELECT count(*)::int FROM investigations i WHERE i.started_by = u.name) AS investigations,
            (SELECT max(t.last_seen_at) FROM connector_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL) AS connector_seen
       FROM app_users u ORDER BY u.disabled_at NULLS FIRST, u.is_admin DESC, u.name`, [String(sessionIdleMs())]);
  return Response.json({
    users: users.map((u) => { const c = connectorStatus(String(u.name)); return { ...u, connector_online: c.online, connector_kind: c.version?.startsWith("ext-") ? "extension" : c.version ? "terminal" : null }; }),
    me: g.user.name,
    mail_configured: mailSettings().configured, // the Add user form offers the welcome email only when this is on
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { action?: string; name?: string; email?: string; admin?: boolean; password?: string; display_name?: string; confirm?: string;
    welcome?: boolean; appUrl?: string };
  const name = (b.name || "").trim().toLowerCase();
  const self = name === g.user.name;
  const one = async (sql: string, params: unknown[]) => {
    const r = await q<{ name: string }>(sql + " RETURNING name", params);
    if (!r.length) throw new Error(`No user named "${name}"`);
  };
  try {
    switch (b.action) {
      case "add": {
        // A login: a username, a name, and at least one way in — a password, and/or a Google email.
        const username = name;
        if (!/^[a-z0-9._-]{2,64}$/.test(username)) throw new Error("Username: 2–64 of a-z 0-9 . _ -");
        const display = (b.display_name || "").trim().slice(0, 120) || null;
        const email = (b.email || "").trim().toLowerCase() || null;
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That email doesn't look right");
        if (!email && !b.password) throw new Error("Give them a password, a Google email, or both — otherwise they can't sign in");
        if (b.password) { const problem = passwordProblem(b.password, username); if (problem) throw new Error(`Password: ${problem}`); }
        const [taken] = await q<{ name: string; email: string | null }>(`SELECT name, email FROM app_users WHERE name = $1 OR ($2::text IS NOT NULL AND lower(email) = $2)`, [username, email]);
        if (taken) throw new Error(taken.name === username ? `The username "${username}" is taken` : `${email} already has a login (${taken.name})`);
        await q(`INSERT INTO app_users (name, display_name, email, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5)`,
          [username, display, email, b.password ? await hashPassword(b.password) : null, !!b.admin]);
        const how = [b.password && `username "${username}" + password`, email && `Google (${email})`].filter(Boolean).join(" or ");
        // Welcome email with the onboarding steps (the password itself is never emailed).
        let mailNote = "";
        if (b.welcome && email) {
          const [me] = await q<{ display_name: string | null }>(`SELECT display_name FROM app_users WHERE name=$1`, [g.user.name]);
          const m = welcomeEmail({ name: display || username, username, email, admin: !!b.admin, addedBy: me?.display_name || g.user.name,
            appUrl: adminSetting("APP_URL") || String(b.appUrl || ""), hasPassword: !!b.password });
          mailNote = await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments })
            .then(() => ` · welcome email sent to ${email}`)
            .catch((e: Error) => ` · welcome email NOT sent (${e.message.slice(0, 120)})`);
        }
        return Response.json({ ok: true, message: `Added ${display || username} as ${b.admin ? "admin" : "member"} — they sign in with ${how}${mailNote}` });
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
      case "delete": {
        // Permanent: the login, its sessions, its extension link and its stored sign-ins. Their investigations stay.
        if (self) throw new Error("You can't delete yourself");
        if ((b.confirm || "").trim().toLowerCase() !== name) throw new Error("Type the username exactly to confirm");
        await one(`DELETE FROM app_users WHERE name = $1`, [name]);
        await q(`DELETE FROM private_files WHERE path LIKE $1`, [`.auth/users/${name}/%`]);
        try { rmSync(userAuthDir(name), { recursive: true, force: true }); } catch { /* nothing stored */ }
        return Response.json({ ok: true, message: `${name} was deleted. Their past investigations are kept.` });
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
