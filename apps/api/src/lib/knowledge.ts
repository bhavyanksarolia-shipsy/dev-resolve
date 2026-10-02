import "server-only";
import { existsSync, readdirSync, readFileSync, mkdirSync, cpSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Account, ROOT } from "./config";
import { q } from "./db";

const KB = path.join(ROOT, "knowledge");
const ALLOWED_FILES = /^(playbook|schema|log-patterns|glossary)\.md$|^queries\/[a-z0-9][a-z0-9_-]*\.sql$/;

function readDir(dir: string): { file: string; content: string }[] {
  if (!existsSync(dir)) return [];
  const out: { file: string; content: string }[] = [];
  for (const f of readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    if (f === "queries" && existsSync(full)) {
      for (const qf of readdirSync(full).filter((x) => x.endsWith(".sql")).sort()) {
        out.push({ file: `queries/${qf}`, content: readFileSync(path.join(full, qf), "utf8") });
      }
    } else if (f.endsWith(".md")) {
      out.push({ file: f, content: readFileSync(full, "utf8") });
    }
  }
  return out;
}

/** Layer 1: the shared + account playbooks, formatted for the agent's system prompt. */
export function accountKnowledge(account: Account): string {
  const parts: string[] = [];
  for (const { file, content } of readDir(path.join(KB, "_shared"))) parts.push(`### _shared/${file}\n${content}`);
  const accDir = path.join(ROOT, account.knowledge_dir);
  const files = readDir(accDir);
  if (!files.length) parts.push(`### ${account.slug}/\n_No account-specific knowledge yet._`);
  for (const { file, content } of files) parts.push(`### ${account.slug}/${file}\n${content}`);
  return parts.join("\n\n");
}

export interface CaseRow {
  id: number;
  ticket_display: string;
  title: string;
  category: string | null;
  symptoms: string | null;
  root_cause: string | null;
  resolution: string | null;
  evidence: unknown;
  rank: number;
}

/** Layer 2: most similar resolved cases for this account (Postgres full-text search). */
export async function similarCases(accountSlug: string, text: string, limit = 5): Promise<CaseRow[]> {
  const terms = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 30);
  if (!terms.length) return [];
  return q<CaseRow>(
    `SELECT id, ticket_display, title, category, symptoms, root_cause, resolution, evidence,
            ts_rank(search, to_tsquery('english', $2)) AS rank
       FROM cases
      WHERE account_slug = $1 AND search @@ to_tsquery('english', $2)
      ORDER BY rank DESC, created_at DESC
      LIMIT $3`,
    [accountSlug, terms.join(" | "), limit],
  );
}

export async function proposeKnowledge(p: { investigationId: number; accountSlug: string; file: string; content: string; rationale: string; source?: string }) {
  if (!ALLOWED_FILES.test(p.file)) throw new Error(`file must be one of playbook.md, schema.md, log-patterns.md, glossary.md or queries/<name>.sql — got ${p.file}`);
  const [row] = await q<{ id: number }>(
    `INSERT INTO knowledge_proposals (investigation_id, account_slug, file, content, rationale, source)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [p.investigationId, p.accountSlug, p.file, p.content, p.rationale, p.source ?? "agent"],
  );
  return row.id;
}

/** Applies an accepted proposal to the markdown files (creating the account folder from _template on first use). */
export function applyToFiles(account: Account | { slug: string; knowledge_dir: string }, file: string, content: string, meta: string) {
  if (!ALLOWED_FILES.test(file)) throw new Error(`Refusing to write ${file}`);
  const dir = path.join(ROOT, account.knowledge_dir);
  if (!existsSync(dir)) {
    mkdirSync(path.dirname(dir), { recursive: true });
    cpSync(path.join(KB, "_template"), dir, { recursive: true });
  }
  const target = path.join(dir, file);
  if (!target.startsWith(dir + path.sep)) throw new Error("path escape");
  if (file.startsWith("queries/")) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `-- ${meta}\n${content.trim()}\n`);
  } else {
    appendFileSync(target, `\n\n<!-- ${meta} -->\n${content.trim()}\n`);
  }
}
