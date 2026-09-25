import "server-only";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { Account, CODE_ROOT, ROOT, toolEnv } from "../config";
import { q } from "../db";
import { proposeKnowledge, similarCases } from "../knowledge";

const MAX_OUT = 15000;
const clip = (s: string) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + `\n…[truncated ${s.length - MAX_OUT} chars — narrow the query]` : s);
const text = (s: string) => ({ content: [{ type: "text" as const, text: clip(s) }] });

function run(cmd: string, args: string[], timeoutMs = 90000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: toolEnv() as NodeJS.ProcessEnv, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve(`${stderr || err.message}`.trim());
      resolve(`${stdout}${stderr ? `\n[stderr] ${stderr}` : ""}`.trim());
    });
  });
}

const METABASE = path.join(ROOT, ".claude/skills/reliance-metabase-query/query.py");

/**
 * In-process MCP server with the Dev Resolve tools, bound to ONE account per
 * investigation: the agent can't query another tenant's DB by accident.
 * `candidates` is set for ambiguous tickets (e.g. "[WMS] Reliance"): the agent
 * may probe each candidate account to work out which tenant it is.
 */
export function buildToolServer(opts: { investigationId: number; account: Account; candidates: Account[] }) {
  const { investigationId, account } = opts;
  const scope = [account, ...opts.candidates.filter((c) => c.slug !== account.slug)];
  const bySlug = (slug?: string) => (slug ? scope.find((a) => a.slug === slug) : account);

  const metabaseQuery = tool(
    "metabase_query",
    "Run a READ-ONLY SQL query (SELECT/WITH only) against the account's Metabase database. Returns JSON rows. " +
      "Always add a LIMIT and a time filter. Use metabase_tables first if unsure of table names.",
    {
      sql: z.string().describe("SELECT/WITH query"),
      database: z.number().int().optional().describe("Metabase database id; defaults to the account's primary DB"),
      account_slug: z.string().optional().describe("Only for ambiguous tickets: which candidate account to query"),
    },
    async ({ sql, database, account_slug }) => {
      const acc = bySlug(account_slug);
      if (!acc) return text(`Unknown account_slug. Allowed: ${scope.map((a) => a.slug).join(", ")}`);
      if (!acc.metabase_project) return text(`NOT_CONFIGURED: account ${acc.name} has no Metabase connection in config/projects.json yet.`);
      const allowed = [acc.metabase_database, ...Object.values(acc.metabase_databases)].filter((x): x is number => x != null);
      const db = database ?? acc.metabase_database!;
      if (!allowed.includes(db)) return text(`Database ${db} is not configured for ${acc.name}. Allowed: ${allowed.join(", ")}`);
      return text(await run("python3", [METABASE, "sql", sql, "--project", acc.metabase_project, "--database", String(db), "--format", "json", "--timeout", "60"]));
    },
  );

  const metabaseTables = tool(
    "metabase_tables",
    "List tables in the account's Metabase database (id + name). Use to discover schema before writing SQL.",
    { database: z.number().int().optional(), account_slug: z.string().optional() },
    async ({ database, account_slug }) => {
      const acc = bySlug(account_slug);
      if (!acc?.metabase_project) return text(`NOT_CONFIGURED: no Metabase connection for this account.`);
      const out = await run("python3", [METABASE, "tables", "--project", acc.metabase_project, "--database", String(database ?? acc.metabase_database)]);
      return text(out);
    },
  );

  const repos = Array.from(new Set(scope.flatMap((a) => a.code_repos)));
  const codeSearch = tool(
    "code_search",
    `Search the source code (read-only) with an extended regex. Repos: ${repos.join(", ")}. ` +
      "Use it to find where an error message is raised, or what condition gates a status transition.",
    {
      pattern: z.string().describe("Extended regex, e.g. 'No data found|NO DATA FOUND'"),
      repo: z.string().optional().describe(`One of: ${repos.join(", ")}. Defaults to all.`),
      include: z.string().optional().describe("File glob, e.g. '*.py' (default: *.py, *.ts, *.js, *.sql)"),
    },
    async ({ pattern, repo, include }) => {
      const targets = (repo ? [repo] : repos).filter((r) => repos.includes(r)).map((r) => path.join(CODE_ROOT, r)).filter(existsSync);
      if (!targets.length) return text(`No repo found under CODE_ROOT=${CODE_ROOT} for ${repo ?? repos.join(", ")}`);
      const includes = (include ? [include] : ["*.py", "*.ts", "*.js", "*.sql"]).flatMap((g) => ["--include", g]);
      const out = await run("/usr/bin/grep", ["-rnEI", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=migrations", ...includes, "-m", "5", pattern, ...targets], 60000);
      const lines = out.split("\n").map((l) => l.replace(CODE_ROOT + "/", ""));
      return text(lines.length > 120 ? lines.slice(0, 120).join("\n") + `\n…${lines.length - 120} more matches, narrow the pattern` : lines.join("\n") || "No matches.");
    },
  );

  const codeRead = tool(
    "code_read",
    "Read a line range of a source file (path relative to the code root, as returned by code_search).",
    { file: z.string(), start: z.number().int().min(1).optional().describe("Default 1"), end: z.number().int().optional() },
    async ({ file, start = 1, end }) => {
      const full = path.resolve(CODE_ROOT, file);
      if (!existsSync(full)) return text(`Not found: ${file}`);
      const real = realpathSync(full);
      if (!real.startsWith(realpathSync(CODE_ROOT) + path.sep)) return text("Refusing: outside code root");
      const lines = readFileSync(real, "utf8").split("\n");
      const stop = Math.min(end ?? start + 150, lines.length, start + 400);
      return text(lines.slice(start - 1, stop).map((l, i) => `${start + i}\t${l}`).join("\n"));
    },
  );

  const similar = tool(
    "similar_cases",
    "Search previously RESOLVED tickets of this account for similar symptoms. Returns root causes and the evidence that proved them.",
    { text: z.string().describe("Symptoms / error text / category keywords") },
    async ({ text: t }) => {
      const rows = await similarCases(account.slug, t);
      if (!rows.length) return text("No similar resolved cases yet for this account.");
      return text(JSON.stringify(rows, null, 1));
    },
  );

  const propose = tool(
    "propose_knowledge",
    "Propose a durable learning for this account's knowledge base (a human reviews it before it is saved). " +
      "Only propose things you VERIFIED in this investigation: a proven query, what a log line means, a table/status fact, an identifier format, " +
      "or a playbook step. Do not propose ticket-specific facts.",
    {
      file: z.string().describe("playbook.md | schema.md | log-patterns.md | glossary.md | queries/<snake_name>.sql"),
      content: z.string().describe("Markdown (or SQL with a header comment) to append"),
      rationale: z.string().describe("What in this investigation proved it"),
      scope: z.enum(["account", "shared"]).optional().describe("Default 'account'. 'shared' only for facts true for every WMS tenant"),
    },
    async ({ file, content, rationale, scope: s }) => {
      const id = await proposeKnowledge({ investigationId, accountSlug: s === "shared" ? "_shared" : account.slug, file, content, rationale });
      return text(`Proposal #${id} filed for human review.`);
    },
  );

  const submit = tool(
    "submit_rca",
    "Submit the final RCA (full text, all sections). Call once at the end of an investigation, and again during a follow-up chat only if the new findings change the RCA — each call creates a new draft version. The human reviews/edits it before it is posted as an INTERNAL comment.",
    {
      rca_markdown: z.string().describe("Full RCA in markdown, using the required sections"),
      category: z.string().describe("snake_case issue category, e.g. pgi_failure"),
      confidence: z.enum(["high", "medium", "low"]),
      symptoms: z.string().describe("1-2 lines: what the customer saw"),
      root_cause: z.string().describe("1-3 lines"),
      resolution: z.string().describe("Fix / next step and owner"),
      current_status: z
        .enum(["still_broken", "resolved_manually", "resolved_automatically", "partially_resolved", "unknown"])
        .describe("State of the affected data NOW, re-checked just before submitting"),
      current_status_detail: z.string().describe("Proof + who/when/how if it was fixed (e.g. 'picklist PL123 created manually by user X at 14:05 via Create Picklist API')"),
      evidence: z.array(z.object({ source: z.string(), query: z.string(), finding: z.string() })).describe("The log searches / SQL / code refs that proved it"),
      resolved_account_slug: z.string().optional().describe("For ambiguous tickets: which account it turned out to be"),
    },
    async (a) => {
      const caseDraft = {
        symptoms: a.symptoms, root_cause: a.root_cause, resolution: a.resolution, evidence: a.evidence,
        current_status: a.current_status, current_status_detail: a.current_status_detail,
      };
      const resolved = a.resolved_account_slug && bySlug(a.resolved_account_slug) ? a.resolved_account_slug : null;
      await q(
        `UPDATE investigations SET draft_rca=$2, category=$3, confidence=$4, case_draft=$5,
                account_slug=COALESCE($6, account_slug), status='draft_ready', error=NULL, finished_at=now(),
                rca_version = rca_version + 1
          WHERE id=$1`,
        [investigationId, a.rca_markdown, a.category, a.confidence, JSON.stringify(caseDraft), resolved],
      );
      return text("RCA saved as a new draft version for human review. Stop here and give the reviewer a short summary of what changed (if anything).");
    },
  );

  return createSdkMcpServer({
    name: "devresolve",
    version: "0.1.0",
    tools: [metabaseQuery, metabaseTables, codeSearch, codeRead, similar, propose, submit],
  });
}
