import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionUser } from "@/lib/auth";
import { CONFIG_DIR, ROOT } from "@/lib/config";
import { savePrivate } from "@/lib/privateStore";
import { getPool } from "@/lib/db";

/**
 * Admin-only: upload the private files the backend needs (hosts like Railway have no "secret files"):
 *   projects.json        accounts + connections        → config/projects.json
 *   config.env           endpoints / credentials       → config/config.env
 *   knowledge.tgz        knowledge folders (tar.gz)    → knowledge/ (merged; existing newer files kept)
 * GET = what's on the server now (sizes + dates only, never contents).
 */
const MAX = 5 * 1024 * 1024;

async function admin(req: Request) {
  const u = await sessionUser(req);
  return u?.isAdmin ? u : null;
}

const info = (p: string) => (existsSync(p) ? { present: true, size: statSync(p).size, updated: statSync(p).mtime.toISOString() } : { present: false });

export async function GET(req: Request) {
  if (!(await admin(req))) return Response.json({ error: "Admins only" }, { status: 403 });
  // What's saved in the database (kept across deploys) — sizes and dates only, never contents.
  const { rows } = await getPool().query(
    `SELECT CASE WHEN path LIKE 'knowledge/%' THEN 'knowledge' ELSE split_part(path, '/', 2) END AS k,
            sum(length(content))::int AS size, max(updated_at) AS updated, count(*)::int AS files
       FROM private_files WHERE path LIKE 'config/%' OR path LIKE 'knowledge/%' GROUP BY 1`);
  const db = Object.fromEntries(rows.map((r) => [r.k, { present: true, size: r.size, updated: new Date(r.updated).toISOString(), files: r.files }]));
  return Response.json({
    "projects.json": db["projects.json"] ?? info(path.join(CONFIG_DIR, "projects.json")),
    "config.env": db["config.env"] ?? info(path.join(CONFIG_DIR, "config.env")),
    knowledge: db.knowledge ?? info(path.join(ROOT, "knowledge")),
  });
}

function writeAtomic(file: string, data: Buffer) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.upload-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
}

export async function POST(req: Request) {
  const u = await admin(req);
  if (!u) return Response.json({ error: "Admins only" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") || "");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file" }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "File is over 5 MB" }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  // The real files sit next to their templates (projects.example.json, config.env.example) — easy to pick by mistake.
  if (/example/i.test(file.name)) {
    return Response.json({ error: `"${file.name}" is the empty template — pick ${kind === "knowledge.tgz" ? "the knowledge archive" : kind} itself (same folder)` }, { status: 400 });
  }
  try {
    if (kind === "projects.json") {
      const j = JSON.parse(data.toString("utf8"));
      if (!Array.isArray(j.accounts)) throw new Error("projects.json must have an \"accounts\" list");
      if (j.accounts.length && j.accounts.every((a: { slug?: string }) => /^(acme|globex)/.test(a.slug || ""))) {
        throw new Error("that's the example projects.json (Acme / Globex) — upload your real config/projects.json");
      }
      writeAtomic(path.join(CONFIG_DIR, "projects.json"), data);
      await savePrivate(path.join(CONFIG_DIR, "projects.json"), u.name);
      return Response.json({ ok: true, message: `projects.json saved — ${j.accounts.length} accounts` });
    }
    if (kind === "config.env") {
      const lines = data.toString("utf8").split("\n").map((l) => l.trim()).filter((l) => /^[A-Z0-9_]+=/.test(l));
      const keys = lines.length;
      if (!keys) throw new Error("config.env has no KEY=value lines");
      if (lines.every((l) => l.endsWith("="))) throw new Error("every value in that config.env is empty — that's the template; upload your real config/config.env");
      writeAtomic(path.join(CONFIG_DIR, "config.env"), data);
      await savePrivate(path.join(CONFIG_DIR, "config.env"), u.name);
      return Response.json({ ok: true, message: `config.env saved — ${keys} settings` });
    }
    if (kind === "knowledge.tgz") {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "kb-"));
      try {
        writeFileSync(path.join(tmp, "k.tgz"), data);
        // Refuse archives that would write outside the knowledge folder.
        const names = execFileSync("tar", ["-tzf", path.join(tmp, "k.tgz")]).toString().split("\n").filter(Boolean);
        if (names.some((n) => n.startsWith("/") || n.split("/").includes(".."))) throw new Error("archive has unsafe paths");
        const dest = path.join(ROOT, "knowledge");
        mkdirSync(dest, { recursive: true });
        execFileSync("tar", ["-xzf", path.join(tmp, "k.tgz"), "-C", dest, "--keep-newer-files", "--no-same-owner"]);
        for (const n of names.filter((x) => !x.endsWith("/"))) await savePrivate(path.join(dest, n.replace(/^\.\//, "")), u.name);
        return Response.json({ ok: true, message: `knowledge merged — ${names.filter((n) => !n.endsWith("/")).length} files` });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    return Response.json({ error: "kind must be projects.json, config.env or knowledge.tgz" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
