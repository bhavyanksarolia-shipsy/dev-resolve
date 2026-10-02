/**
 * Manage Dev Resolve logins (stored hashed in Postgres). Passwords are typed hidden — never passed as arguments.
 *   npm run user -- list
 *   npm run user -- add <name> [--admin]      create a user (asks for the password twice)
 *   npm run user -- add-google <email> [--admin]   pre-add a Google sign-in user (no password)
 *   npm run user -- reset <name>              new password; signs that user out everywhere
 *   npm run user -- admin <name> on|off       grant / remove admin
 *   npm run user -- disable <name>            block logins + end their sessions (history is kept)
 *   npm run user -- enable <name>
 *   npm run user -- signout <name>|--all      end sessions without changing passwords
 */
import { Client } from "pg";
import { hashPassword, passwordProblem } from "../src/lib/passwords";
import { pgConfig } from "../src/lib/pgConfig";

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error("Run this in a terminal (the password is typed hidden)."));
    stdout.write(prompt);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let pw = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); stdout.write("\n"); return resolve(pw); }
        if (c === "\u0003") { stdout.write("\n"); process.exit(130); }
        if (c === "\u007f" || c === "\b") pw = pw.slice(0, -1); else pw += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function newPassword(name: string) {
  const p1 = await askHidden(`New password for '${name}': `);
  const problem = passwordProblem(p1, name);
  if (problem) throw new Error(`${problem} Nothing changed.`);
  if ((await askHidden("Repeat it: ")) !== p1) throw new Error("Passwords don't match — nothing changed.");
  return hashPassword(p1);
}

async function main() {
  const [cmd, rawName, arg] = process.argv.slice(2);
  const name = rawName?.trim().toLowerCase();
  const { connectionString, ssl } = pgConfig();
  const db = new Client({ connectionString, ssl });
  await db.connect();
  const one = async (sql: string, params: unknown[]) => {
    const r = await db.query(sql, params);
    if (!r.rowCount) throw new Error(`No user named '${name}'. See: npm run user -- list`);
  };
  try {
    switch (cmd) {
      case "list": {
        const r = await db.query(`SELECT u.name, u.email, u.password_hash IS NOT NULL AS has_pw, u.is_admin, u.disabled_at, u.last_login_at, u.locked_until,
            (SELECT count(*) FROM app_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS sessions
          FROM app_users u ORDER BY u.name`);
        console.table(r.rows.map((u) => ({ name: u.name, email: u.email ?? "", sign_in: [u.email && "google", u.has_pw && "password"].filter(Boolean).join("+"), role: u.is_admin ? "admin" : "member",
          status: u.disabled_at ? "disabled" : u.locked_until && u.locked_until > new Date() ? "locked (wrong passwords)" : "active",
          "last login": u.last_login_at?.toISOString().slice(0, 16).replace("T", " ") ?? "never", "open sessions": Number(u.sessions) })));
        break;
      }
      case "add-google": {
        const email = rawName?.trim().toLowerCase();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Usage: npm run user -- add-google <email> [--admin]");
        const base = email.split("@")[0].replace(/[^a-z0-9._-]/g, "-").slice(0, 60);
        const r = await db.query(`INSERT INTO app_users (name, email, is_admin) VALUES ($1, $2, $3)
          ON CONFLICT (name) DO NOTHING RETURNING name`, [base, email, arg === "--admin"]);
        if (!r.rowCount) throw new Error(`A user named '${base}' already exists — use their existing login or add them with a different name`);
        console.log(`Added ${email} as '${base}' (${arg === "--admin" ? "admin" : "member"}) — they sign in with Google.`);
        break;
      }
      case "add": {
        if (!name || !/^[a-z0-9._-]{2,64}$/.test(name)) throw new Error("Name: 2–64 of a-z 0-9 . _ -");
        const hash = await newPassword(name);
        await db.query(`INSERT INTO app_users (name, password_hash, is_admin) VALUES ($1, $2, $3)`, [name, hash, arg === "--admin"]);
        console.log(`Created '${name}' (${arg === "--admin" ? "admin" : "member"}). Share the password with them privately.`);
        break;
      }
      case "reset": {
        const hash = await newPassword(name);
        await one(`UPDATE app_users SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE name = $1`, [name, hash]);
        console.log(`Password for '${name}' changed; their existing sessions are signed out.`);
        break;
      }
      case "admin":
        if (arg !== "on" && arg !== "off") throw new Error("Usage: npm run user -- admin <name> on|off");
        await one(`UPDATE app_users SET is_admin = $2 WHERE name = $1`, [name, arg === "on"]);
        console.log(`'${name}' is now ${arg === "on" ? "an admin" : "a member"}.`);
        break;
      case "disable":
        await one(`UPDATE app_users SET disabled_at = now() WHERE name = $1`, [name]);
        await db.query(`UPDATE app_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id = (SELECT id FROM app_users WHERE name = $1)`, [name]);
        console.log(`'${name}' disabled and signed out.`);
        break;
      case "enable":
        await one(`UPDATE app_users SET disabled_at = NULL, failed_logins = 0, locked_until = NULL WHERE name = $1`, [name]);
        console.log(`'${name}' can sign in again.`);
        break;
      case "signout": {
        const r = rawName === "--all"
          ? await db.query(`UPDATE app_sessions SET revoked_at = now() WHERE revoked_at IS NULL`)
          : await db.query(`UPDATE app_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id = (SELECT id FROM app_users WHERE name = $1)`, [name]);
        console.log(`Ended ${r.rowCount} session(s).`);
        break;
      }
      default:
        console.log("Usage: npm run user -- list | add <name> [--admin] | add-google <email> [--admin] | reset <name> | admin <name> on|off | disable <name> | enable <name> | signout <name>|--all");
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
