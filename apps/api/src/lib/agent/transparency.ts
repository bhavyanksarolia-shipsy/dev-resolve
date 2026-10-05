import "server-only";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../config";
import { q } from "../db";

/**
 * Admin → Connections → Claude, "What it can do / What we keep": a plain account of the agent's tools, its limits,
 * and what Dev Resolve stores about its work. Keep AGENT_TOOLS in step with buildToolServer (tools.ts) and the
 * mcpServers / canUseTool rules in run.ts.
 */
export const AGENT_TOOLS: { group: string; tools: { name: string; does: string }[] }[] = [
  { group: "Client logs", tools: [
    { name: "search_logs", does: "Searches the client's OpenSearch logs (only the log types of the ticket's client)" },
    { name: "list_log_types", does: "Lists which log types exist" },
  ] },
  { group: "Shipsy app logs", tools: [
    { name: "SearchIndexTool · CountTool · ListIndexTool · IndexMappingTool", does: "Read-only search of the app logs, limited to the client's indices and company — signed in as the person investigating" },
  ] },
  { group: "Database", tools: [
    { name: "metabase_query", does: "Runs read-only SQL (SELECT / WITH only) on the client's Metabase database" },
    { name: "metabase_tables", does: "Lists the tables in that database" },
  ] },
  { group: "Code", tools: [
    { name: "code_search", does: "Searches the client's linked repositories (read-only copy on the server)" },
    { name: "code_read", does: "Reads lines of a file found by code_search" },
  ] },
  { group: "History", tools: [
    { name: "past_tickets", does: "Closed DevRev tickets of the same client with a similar title, and how they were closed" },
    { name: "similar_cases", does: "Earlier Dev Resolve root causes for this client" },
  ] },
  { group: "Skills", tools: [
    { name: "read_skill", does: "Opens a skill below (the full playbook) when the ticket matches its description — only skills assigned to the ticket's client" },
  ] },
  { group: "Writes (Dev Resolve only)", tools: [
    { name: "propose_knowledge", does: "Adds a verified learning to the client's knowledge base (admins can review or remove it)" },
    { name: "submit_rca", does: "Saves an RCA draft version for a person to review — it never posts by itself" },
  ] },
];

export const AGENT_LIMITS = [
  "No shell, no file edits, no web browsing — only the tools above (built-in Claude Code tools are switched off).",
  "Scoped to the ticket's client (plus clients of the same group); other tenants' logs and databases are refused.",
  "Database access is read-only: anything other than SELECT / WITH is refused before it reaches Metabase.",
  "Logs and databases are reached with the connection's saved credentials or the investigator's own sign-ins (through their Connector) — the agent never sees a password.",
  "Cannot post to DevRev or change a ticket — a person reviews the RCA and posts it; Stage / Pod / Part / owner changes are made by people.",
  "Up to 60 steps per run.",
];

export const SENT_TO_ANTHROPIC =
  "For each run: the ticket's title, description and comments, its attachments (images, PDFs, emails), notes and files the reviewer adds, " +
  "the knowledge base for that client, and every tool result (log lines, query rows, code excerpts). Anthropic processes it under the " +
  "terms of the account the token belongs to.";

const STORED: { table: string; label: string; what: string; when?: string }[] = [
  { table: "investigations", label: "Investigations", what: "Ticket, status, who started it, RCA drafts and versions, cost and step count", when: "created_at" },
  { table: "investigation_steps", label: "Investigation steps", what: "Every tool call and its result (queries, log hits, code excerpts), the agent's messages and the reviewer's chat", when: "created_at" },
  { table: "agent_runs", label: "Agent runs", what: "Per run: who started it, model, tokens (input / output / cache) and cost", when: "started_at" },
  { table: "chat_files", label: "Uploaded files", what: "Files added in Chat or as start notes, kept so the agent can re-read them", when: "created_at" },
  { table: "cases", label: "Resolved cases", what: "Root cause, resolution and evidence of finished investigations — used by similar_cases", when: "created_at" },
  { table: "knowledge_proposals", label: "Knowledge", what: "Learnings the agent proposed (proven queries, log meanings, playbook steps)", when: "created_at" },
];

/** Session transcripts the Claude Agent SDK keeps on the server's disk (used to resume a chat where it left off). */
function sessionFiles() {
  // The SDK files them under projects/<the agent's working folder, non-alphanumerics as "-"> — only that folder,
  // not other Claude Code sessions on the same machine.
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects", ROOT.replace(/[^a-zA-Z0-9]/g, "-"));
  let files = 0, bytes = 0;
  const walk = (d: string, depth: number) => {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) { files++; try { bytes += statSync(p).size; } catch { /* gone */ } }
    }
  };
  walk(dir, 0);
  return { files, bytes };
}

export async function storageSummary() {
  const rows = await Promise.all(STORED.map(async (s) => {
    const [r] = await q<{ n: number; bytes: number; since: string | null }>(
      `SELECT (SELECT count(*)::int FROM ${s.table}) AS n, pg_total_relation_size('${s.table}')::float AS bytes,
              ${s.when ? `(SELECT min(${s.when}) FROM ${s.table})` : "NULL"} AS since`,
    ).catch(() => [{ n: 0, bytes: 0, since: null }]);
    return { label: s.label, what: s.what, count: r.n, bytes: r.bytes, since: r.since };
  }));
  const sf = sessionFiles();
  rows.push({ label: "Agent sessions", what: "Claude's own transcript of each investigation on the server's disk, so a Chat continues where it stopped", count: sf.files, bytes: sf.bytes, since: null });
  return rows;
}
