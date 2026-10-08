import "server-only";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { adminSetting, Account, ROOT, getAccount, getAccounts, projectForLogType, resolveDevrevAccount } from "../config";
import { gatewayCarrier, relaySecret, userToolEnv } from "../connector";
import { chainFor, endRun, noRouteMessage, takeRouteEvents } from "../claudeRoute";
import { settings } from "../settings";
import { LockedError, q } from "../db";
import { getTicket, listTimeline } from "../devrev";
import { accountKnowledge } from "../knowledge";
import { skillsFor } from "../skills";
import { agentAttachmentBlocks, listAttachments, uploadedFileBlocks, withEmailSenders } from "../attachments";
import { buildToolServer } from "./tools";
import { appLogConfigDir, appLogProjects, ensureAppLogAuth, indexAllowed } from "../applog";

export const DEFAULT_MODEL = "claude-opus-5-5";
/** Model and Claude sign-in: values saved in Admin → Connections → Claude win over the server variables. */
export const agentModel = () => adminSetting("DEV_RESOLVE_MODEL") || DEFAULT_MODEL;
/**
 * Claude sign-in for the agent. The main one is what Admin → Connections → Claude says (Bifrost, an Anthropic API key or
 * a login token). With a fallback (the person's own Claude token, the server's login) or a VPN-only gateway, the agent
 * talks to this server's /api/llm-relay, which tries each in turn per request (lib/claudeRoute.ts).
 */
function claudeEnv(user?: string, runId?: number): Record<string, string | undefined> {
  const chain = chainFor(user);
  const main = chain[0];
  if (!main) return { ...process.env, ANTHROPIC_BASE_URL: undefined }; // this computer's own Claude Code login (local setups)
  const clean = { ...process.env, ANTHROPIC_BASE_URL: undefined, ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_OAUTH_TOKEN: undefined };
  if (chain.length === 1 && !main.viaExtension) {
    // One way only: straight there. Gateways read the key from x-api-key; Bifrost virtual keys (sk-bf-…) also as x-bf-vk.
    if (main.auth === "oauth") return { ...clean, CLAUDE_CODE_OAUTH_TOKEN: main.secret };
    return { ...clean, ANTHROPIC_API_KEY: main.secret, ...(main.base !== "https://api.anthropic.com" && { ANTHROPIC_BASE_URL: main.base }),
      ...(main.secret.startsWith("sk-bf-") && { ANTHROPIC_CUSTOM_HEADERS: `x-bf-vk: ${main.secret}` }) };
  }
  // The agent signs as a login token when any in the chain is one (requests then carry what login tokens need); the relay
  // re-signs every request for whichever sign-in answers it.
  const oauth = chain.find((u) => u.auth === "oauth");
  const headers = [`x-relay-secret: ${relaySecret()}`, `x-relay-user: ${user ?? ""}`, runId ? `x-relay-run: ${runId}` : ""].filter(Boolean);
  return { ...clean, ANTHROPIC_BASE_URL: `${settings.internalUrl()}/api/llm-relay`, ANTHROPIC_CUSTOM_HEADERS: headers.join("\n"), API_TIMEOUT_MS: "660000",
    ...(oauth ? { CLAUDE_CODE_OAUTH_TOKEN: oauth.secret } : { ANTHROPIC_API_KEY: main.secret }) };
}
/** A session that ended because Claude couldn't be reached (not because of the investigation itself). */
const CLAUDE_DOWN = /API Error|Connection error|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|overloaded|timed? ?out|terminated|isn't working right now|isn't reachable|\b5\d\d\b/i;
/**
 * Is Claude's saved conversation for this session still on this server's disk? The SDK keeps it under
 * projects/<working folder> — and a redeploy on a host without a volume (Railway) wipes it.
 */
function sessionOnDisk(sid: string) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects", ROOT.replace(/[^a-zA-Z0-9]/g, "-"));
  return existsSync(path.join(dir, `${sid}.jsonl`));
}
const OS_SERVER = "opensearch-logs";
const APP_LOG = "shipsy-app-log";
const running = new Map<number, AbortController>();

async function step(investigationId: number, seq: number, kind: string, tool: string | null, input: unknown, output: string | null) {
  await q(`INSERT INTO investigation_steps (investigation_id, seq, kind, tool, input, output) VALUES ($1,$2,$3,$4,$5,$6)`, [
    investigationId,
    seq,
    kind,
    tool,
    input === undefined ? null : JSON.stringify(input),
    output,
  ]);
}

/** Skills for this ticket: name + "when to use" only; the agent opens one with read_skill (keeps the prompt small). */
function skillText(scope: Account[]) {
  const list = skillsFor(scope);
  if (!list.length) return "";
  return `# Skills (playbooks added by admins)
Before investigating, check this list. When the ticket matches a skill's description, open it with
mcp__devresolve__read_skill and follow it — it holds proven methods for that kind of ticket.
${list.map((s) => `- **${s.name}** — ${s.description}`).join("\n")}`;
}

function systemPrompt(account: Account, candidates: Account[]) {
  const scope = [account, ...candidates.filter((c) => c.slug !== account.slug)];
  const conn = scope
    .map(
      (a) =>
        `- **${a.name}** (slug \`${a.slug}\`, status ${a.status}): ` +
        (a.app_log
          ? `Shipsy app logs (mcp__${APP_LOG}__*) indices ${JSON.stringify(a.app_log.indices)}${a.app_log.company ? `; SHARED index — every search/count MUST filter company.keyword ${Array.isArray(a.app_log.company) ? `IN ${JSON.stringify(a.app_log.company)} (use a terms filter)` : `= "${a.app_log.company}"`}` : ""}${a.app_log.warehouses?.length ? ` (or filter warehouse.keyword IN ${JSON.stringify(a.app_log.warehouses)} — some lines have no company)` : ""}; `
          : `log types ${JSON.stringify(a.opensearch_log_types)}; `) +
        `Metabase project ${a.metabase_project ?? "NOT CONFIGURED"} db ${a.metabase_database ?? "-"} (all: ${JSON.stringify(a.metabase_databases)})` +
        (a._shared_db_note ? ` — ⚠️ SHARED DATABASE: first find this account's warehouse/user ids (e.g. from the warehouse codes in the ticket or the user/company tables) and restrict EVERY query to them; never report other clients' rows` : "") +
        `; repos ${a.code_repos.join(", ")}`,
    )
    .join("\n");
  return `You are Dev Resolve, a senior Shipsy support engineer producing a root-cause analysis (RCA) for a DevRev ticket.
Work like an investigator: evidence first, conclusions second. Never guess.

# Account scope
${candidates.length > 1 ? `The ticket is filed under **${account.name}**, but every tenant below is in your scope (same company / possible clients). If the evidence (warehouse codes, order or document ids that don't exist here, a known misrouting pattern) points to another tenant below, INVESTIGATE THERE YOURSELF with that tenant's log types and database, and set resolved_account_slug in submit_rca. Never end with "re-check it in tenant X" or "re-map the ticket" when X is listed below — you can check it, so check it.\n` : ""}${conn}

# Tools
- mcp__${OS_SERVER}__search_logs — OpenSearch logs. ALWAYS pass log_type explicitly, only from the log types above.
  app = application logs, audit = who-did-what API audit (request/response bodies), integration = SAP/ERP middleware.
  Use hours_back to cover the reported time (tickets can be days old; widen up to 720h). Phrase-match on 'query'.
${scope.some((a) => a.app_log) ? `- mcp__${APP_LOG}__SearchIndexTool / CountTool / ListIndexTool / IndexMappingTool — Shipsy application logs (read-only).
  Only the indices listed for the account. \`query_dsl\` / \`body\` is the FULL body: {"query": {...}, "sort": [{"timestamp": "desc"}], "_source": [...]}.
  Time field is \`timestamp\` — ranges need "format": "strict_date_optional_time||epoch_millis". Text fields have a \`.keyword\` subfield
  (use it for exact filters/terms, e.g. company.keyword, warehouse.keyword). Keep size ≤ 20 and pick \`_source\` fields (message, level,
  warehouse, user, request_id, timestamp) — results are not truncated. Useful fields: message, level, warehouse, user, company, request_id, url_name.
` : ""}- mcp__devresolve__metabase_query / metabase_tables — read-only SQL on the account's DB. Always LIMIT.
- mcp__devresolve__code_search / code_read — find where an error string is raised and the exact condition.
- mcp__devresolve__past_tickets — closed DevRev tickets of this client with a similar title, and how each was closed. CALL IT FIRST.
- mcp__devresolve__similar_cases — RCAs Dev Resolve wrote for this account before. Check early.

# Recurring tickets — don't re-investigate what history already answers
If past_tickets shows 2 or more closed tickets that clearly match this one (same report, e.g. the same monthly "<site> sync issue" report) and
they were all closed the same way (e.g. the client's team checked and nothing was on Shipsy's end / client-side config / known
behaviour), treat that as the likely answer: run AT MOST 2 quick confirming checks for this ticket's specific identifiers (does the
data look the same as those past cases?), then submit_rca. Say plainly in the RCA that it matches TKT-… and TKT-… (same pattern,
same resolution) and what you confirmed now. Only investigate fully if the confirming checks show something different.
- mcp__devresolve__propose_knowledge — file VERIFIED, reusable learnings (proven query, log meaning, identifier format, playbook step).
- mcp__devresolve__submit_rca — call exactly once at the end.

# Method
1. Extract every identifier from the ticket (delivery/trip/order/GRN/ASN/LPN numbers, DC/warehouse codes, times, exact error text).
2. Decide which system each identifier belongs to before searching. "Not found" in the wrong system is not evidence.
3. Logs for the event trail → DB for current state → code for the real condition. Reconcile into one explanation.
4. CURRENT STATUS (mandatory, do it last, right before submitting): re-query the DB for the affected records NOW and
   compare with the state the customer reported. Things often change after the ticket is raised — e.g. the ticket says
   "picklist not generated", you find why, but the picklist now exists because someone created it manually. Determine:
   - still_broken — the reported state persists (records + values as proof)
   - resolved_manually — fixed by a person/workaround: WHO (username from audit logs), WHEN, and HOW (which API/screen)
   - resolved_automatically — recovered by a retry/cron/upstream resend, with timestamp
   - partially_resolved — say which records are fixed and which are not
   - unknown — only if the data can't be checked; say which connection/record blocked it
   The root cause stays valid even if the data is fixed now — say whether it can recur.
5. Before submitting, propose 1-4 knowledge items that would make the NEXT similar ticket faster.

# Connection failures — critical
If any tool returns VPN_REQUIRED, AUTH_FAILED or NOT_CONFIGURED, that search did NOT happen. Never treat it as "no data".
Retry once. If it still fails and the connection is essential, submit_rca with confidence "low", state exactly which
connection failed at the top of the RCA, and list what remains to be checked once it's fixed.

# RCA format (rca_markdown) — internal audience, be concrete
It is read in DevRev's narrow comment pane, where tables scroll sideways and cut off. Do NOT use tables; use short
bullet lists with **bold labels**, one fact per line, identifiers in \`code\`. Plain words, no tool jargon
("request_contains", "match_phrase", table ids) — say what was checked, not how the search was typed.
## Summary  (2 lines)
## Impact  (bullets — format example only, not real data:
   - **Site:** SAYL (warehouse 737)
   - **Documents:** STR \`STR4767…\` → ASN \`ASN-…\` (6 lines)
   - **When:** gate-in blocked 27–29 Sep; GRN still pending)
## Evidence  (numbered list, one item per check, the FINDING first, then where it came from — format example only:
   1. **Appointment \`11000009\` is already linked to gate pass GP6** (unloaded, not closed) — DB, appointment + gate pass tables
   2. **Every gate-in with GP8 was rejected "appointment already in use"**, 27 Sep 10:42 → 29 Sep 09:15, 5 attempts
      - Verify: audit logs · 27 Sep 10:42:13 IST · request \`abc123de\` (first), \`f00d9876\` (last) · "Appointment already in use"
   Every finding that comes from logs gets a "Verify:" sub-line so a reviewer can find the exact entry: which logs
   (app / audit / integration), the timestamp, the request id(s) — first and last of a series, at most 3 — and the
   exact log message in quotes. Give a request id only when the log entry you found actually has one — copy it exactly
   from the tool result, never guess, shorten or invent it; if the entry has none, leave it out and the timestamp +
   message identify the entry. DB findings: the table and record id. No raw SQL or query syntax — the exact queries
   are in the trail.)
## Root cause  (the code path file:line and condition, or the upstream system, with proof)
## Current status  (state of the data RIGHT NOW vs. what was reported: still broken / fixed manually by whom & when /
   recovered automatically / partially — with the query result that shows it, and whether it can recur)
## Fix / next step  (data fix / code fix / config / upstream team, and owner)
## Confidence  (high/medium/low + what could not be verified)
## Suggested customer reply  (short, no internal system names. State facts and current status only. NEVER mention or
   imply fixes, improvements, product changes, alerts or timelines ("we're improving…", "we'll add…", "this will be fixed") —
   those need team sign-off first. Recommended fixes belong only in the internal "Fix / next step" section.)

${scope.some((a) => a.extra_sources?.length) ? `# Other sources for this client (added by admins — reference only; you can't open these, but name them in "Fix / next step" when a person should check one)
${scope.flatMap((a) => (a.extra_sources ?? []).map((x) => `- **${x.name}**${x.url ? ` — ${x.url}` : ""}${x.notes ? `: ${x.notes}` : ""}`)).join("\n")}

` : ""}# Knowledge base (curated — prefer it over assumptions, but lines marked Unverified must be checked)
${accountKnowledge(account)}

${skillText(scope)}`;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "\n…[comment truncated]" : s);

function ticketPrompt(t: Awaited<ReturnType<typeof getTicket>>, comments: Awaited<ReturnType<typeof listTimeline>>) {
  const conv = comments
    .slice()
    .reverse()
    .map((c) => `[${c.created_date}] (${c.visibility}) ${c.created_by?.display_name || c.created_by?.email || "?"}: ${clip(c.body || "", 15000)}`)
    .join("\n\n");
  return `Investigate DevRev ticket ${t.display_id}: "${t.title}"
Created: ${t.created_date}   Stage: ${t.stage?.name}   Severity: ${t.severity}
Account: ${t.account?.display_name}

## Ticket body
${t.body || "(empty)"}

## Timeline (customer + internal comments, oldest first; other bots' RCAs may be wrong — verify, don't copy)
${conv || "(none)"}`;
}

/** Which configured connection a failing tool call belongs to — so the UI names it. */
function connectionFor(toolName: string, input: Record<string, unknown>, account: Account): string {
  if (toolName.includes(`__${APP_LOG}__`)) return `opensearch_mcp:${account.app_log?.project ?? "shipsy_app_log"} (index ${input.index ?? "-"})`;
  if (toolName.endsWith("search_logs")) {
    const lt = String(input.log_type || account.opensearch_log_type || "");
    return `opensearch:${projectForLogType(lt) ?? "?"} (log_type ${lt})`;
  }
  if (toolName.includes("metabase")) {
    const acc = input.account_slug ? getAccount(String(input.account_slug)) : account;
    return `metabase:${acc?.metabase_project ?? "not configured"} (db ${input.database ?? acc?.metabase_database ?? "-"})`;
  }
  return toolName;
}

/**
 * The client's group (e.g. one company's several products) is in scope too: tickets are often filed under the wrong
 * product account, and the agent must be able to check the right one itself instead of telling a person to.
 */
function withGroup(account: Account, candidates: Account[]) {
  const out = candidates.length ? [...candidates] : [account];
  if (account.group) for (const a of getAccounts()) {
    if (a.group === account.group && a.client_active !== false && !out.some((x) => x.slug === a.slug)) out.push(a);
  }
  return out.length > 1 ? out : [];
}

/** Admin → Claude → "Built-in instructions": the exact system prompt the agent gets for this client's tickets. */
export function promptPreview(slug: string) {
  const a = getAccount(slug);
  return a ? systemPrompt(a, withGroup(a, [])) : null;
}

function resolveScope(accountId: string | undefined, displayId: string, accountName?: string) {
  const res = resolveDevrevAccount(accountId);
  let account: Account | undefined;
  let candidates: Account[] = [];
  if (res.kind === "account") {
    if (res.account.client_active === false) throw new Error(`${res.account.name} is an inactive client — turn it on in Admin → Clients to investigate its tickets`);
    account = res.account;
  } else if (res.kind === "ambiguous") {
    candidates = res.candidates.filter((c) => c.client_active !== false); // only active clients are investigated
    account = candidates[0];
  }
  if (!account) throw new Error(`Ticket ${displayId}'s DevRev account (${accountName ?? "none"}) is not mapped in config/projects.json`);
  return { account, candidates: withGroup(account, candidates) };
}

/** What a reviewer told the agent when starting (ticket page): text and files, saved with the investigation. */
export interface StartNotes { text: string; files: { name: string; type: string; size: number; body: Buffer }[] }

export async function startInvestigation(ticketRef: string, startedBy = "unknown", notes?: StartNotes): Promise<number> {
  const ticket = await getTicket(ticketRef);
  const { account, candidates } = resolveScope(ticket.account?.id, ticket.display_id, ticket.account?.display_name);
  // The unique index investigations_one_running_per_ticket makes this the lock: a second start fails here.
  const row = await q<{ id: number }>(
    `INSERT INTO investigations (ticket_id, ticket_display, ticket_title, account_slug, status, candidate_slugs, started_by)
     VALUES ($1,$2,$3,$4,'running',$5,$6) RETURNING id`,
    [ticket.id, ticket.display_id, ticket.title, account.slug, candidates.map((c) => c.slug), startedBy],
  ).then((r) => r[0]).catch(async (e: { code?: string }) => {
    if (e.code !== "23505") throw e;
    const [cur] = await q<{ started_by: string | null }>(`SELECT started_by FROM investigations WHERE ticket_display=$1 AND status='running'`, [ticket.display_id]);
    throw new LockedError(`${ticket.display_id} is already being investigated${cur?.started_by ? ` (started by ${cur.started_by})` : ""}`);
  });
  // Files from the start notes are kept like chat files (shown in the trail, sent to the agent).
  const noteFiles: (StartNotes["files"][number] & { id: number })[] = [];
  for (const f of notes?.files ?? []) {
    const [r] = await q<{ id: number }>(`INSERT INTO chat_files (investigation_id, name, type, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [row.id, f.name, f.type, f.size, f.body, startedBy]);
    noteFiles.push({ ...f, id: Number(r.id) });
  }
  void runAgent(row.id, ticket, account, candidates, startedBy, notes && (notes.text || noteFiles.length) ? { text: notes.text, files: noteFiles } : undefined).catch(async (e) => {
    await q(`UPDATE investigations SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [row.id, String(e?.message || e)]);
  });
  return row.id;
}

export function cancelInvestigation(id: number) {
  running.get(id)?.abort();
}

const userMessage = (content: SDKUserMessage["message"]["content"]): SDKUserMessage =>
  ({ type: "user", parent_tool_use_id: null, message: { role: "user", content } }) as SDKUserMessage;

async function runAgent(id: number, ticket: Awaited<ReturnType<typeof getTicket>>, account: Account, candidates: Account[], startedBy?: string,
  notes?: { text: string; files: { id: number; name: string; type: string; size: number; body: Buffer }[] }) {
  const comments = await listTimeline(ticket.id).then(withEmailSenders).catch(() => []);
  // Screenshots / files the customer attached (incl. images inside email.eml) go to the agent as real images.
  const attachments = await listAttachments(comments).catch(() => []);
  const attachmentBlocks = await agentAttachmentBlocks(attachments);
  const attachmentList = attachments.length
    ? `\n\n## Attachments on the ticket (${attachments.filter((a) => !a.signature).length})\n` +
      attachments.filter((a) => !a.signature).map((a) => `- ${a.name} (${a.type}, ${Math.round(a.size / 1024)} KB, from ${a.from ?? "?"})`).join("\n") +
      "\nImages, PDFs, emails and the contents of Excel / Word / text files are included below — read them: they often hold the exact error screen, identifiers (invoice, order, SKU lists) and times."
    : "";
  let seq = 0;
  await step(id, seq++, "system", null, { model: agentModel(), account: account.slug, candidates: candidates.map((c) => c.slug) }, `Investigating ${ticket.display_id} as ${account.name}`);
  if (attachments.length) {
    const imgs = attachmentBlocks.filter((b) => b.type === "image").length;
    const emails = attachmentBlocks.filter((b) => b.type === "text" && b.text.startsWith("Attached email")).length;
    const docs = attachmentBlocks.filter((b) => b.type === "document").length;
    const files = attachmentBlocks.filter((b) => b.type === "text" && b.text.startsWith("Attached file")).length;
    await step(id, seq++, "system", null, { attachments: attachments.map((a) => a.name) }, `Read ${attachments.length} attachment(s) · ${imgs} image(s), ${docs} PDF(s), ${emails} email(s), ${files} file(s) sent to the agent${attachments.some((a) => a.signature) ? ` (${attachments.filter((a) => a.signature).length} signature logo(s) skipped)` : ""}`);
  }
  // The reviewer's starting notes: shown at the top of the trail, and given to the agent as leads to verify.
  let notesText = "", noteBlocks: Awaited<ReturnType<typeof uploadedFileBlocks>> = [];
  if (notes) {
    await step(id, seq++, "user_message", null, { by: startedBy, start_notes: true, files: notes.files.map(({ id: fid, name, type, size }) => ({ id: fid, name, type, size })) }, notes.text || "(files only)");
    noteBlocks = notes.files.length ? await uploadedFileBlocks(notes.files) : [];
    notesText = `\n\n## Notes from the reviewer who started this (${startedBy ?? "a reviewer"})\n` +
      `These are LEADS from someone who knows the account — use them to aim your checks, but VERIFY each one against logs / DB / code; ` +
      `they are not evidence. If the data contradicts a note, say so plainly in the RCA.\n\n${notes.text || "(no text)"}` +
      (notes.files.length ? `\n\nThey attached: ${notes.files.map((f) => f.name).join(", ")} — included below; read them.` : "");
  }
  await runSession({
    id, account, candidates, seq,
    message: userMessage([{ type: "text", text: ticketPrompt(ticket, comments) + attachmentList + notesText }, ...attachmentBlocks, ...noteBlocks]),
    kind: "investigation",
    by: startedBy,
  });
  const [inv] = await q<{ status: string }>(`SELECT status FROM investigations WHERE id=$1`, [id]);
  if (inv.status === "running") {
    await q(`UPDATE investigations SET status='failed', error='Agent finished without calling submit_rca', finished_at=now() WHERE id=$1`, [id]);
  }
}

/**
 * Reviewer follow-up on an RCA ("check trip X too", "this was fixed by SAP, re-verify"). Resumes the
 * investigation's own agent session, so it keeps every log search / query / code read from the first run.
 * If the findings change, the agent calls submit_rca again → a new draft version.
 */
/** How chat answers read: one finished explanation, like a senior engineer briefing a colleague — not a log dump. */
const CHAT_REPLY_STYLE = `How to write your reply (the reviewer sees ONLY your last message, so it must stand on its own):
- Do any NEW checks first (see "How to handle this message"), then write ONE complete answer at the end. No "let me check…" text in the answer.
- Start with the answer in 1–2 plain sentences (bold the key fact). What happened, and why.
- Then explain it simply. Any timeline or sequence of events MUST be a markdown table (the "no tables" rule is only for
  the RCA posted to DevRev — chat replies are shown in Dev Resolve, where tables render well):
  | When (IST) | What happened | Result |
  One row per meaningful step, dates in the When cell ("1 Oct 19:47"); merge repeats into one row
  ("1 Oct 20:03 – 2 Oct 12:06 | 20 close attempts by 5 users | all failed, same error"). Other comparisons
  (before/after, expected vs actual, per-store status) are tables too.
- Use everyday words. Name a thing once with its id in \`code\`, then refer to it in words ("the LPN", "the trip").
  Leave out request ids, user ids and other raw identifiers unless the reviewer asked for them or one is the proof of
  the point. Never write lists of request ids inline like "fail [54ca5482, 0130fb7a, …]" — say "4 attempts, all failed".
- When the answer rests on logs, end with a small "Logs to verify" table: | What | Logs | Time (IST) | Request id |
  — the key entries only (first/last of a series, the success, the decisive error), at most 6 rows. Request id only if
  the log entry has one, copied exactly (never guessed); otherwise "—".
- Say plainly what's confirmed vs not, in a final "Still open" line (only if something is).
- If the RCA changed, say in one line what changed. Otherwise don't mention the RCA.
- Keep it short: about 150–250 words unless they asked for the full detail. No preamble, no sign-off, no repeating their question.`;

export async function sendChatMessage(id: number, text: string, by = "unknown", files: { id: number; name: string; type: string; size: number; body: Buffer }[] = []) {
  const [inv] = await q<{
    ticket_id: string; ticket_display: string; account_slug: string; candidate_slugs: string[] | null;
    status: string; session_id: string | null; chat_running: boolean; draft_rca: string | null;
  }>(`SELECT * FROM investigations WHERE id=$1`, [id]);
  if (!inv) throw new Error("investigation not found");
  if (inv.status === "running" || inv.chat_running) throw new LockedError("The agent is still working on this ticket — wait for it to finish.");
  let account = getAccount(inv.account_slug);
  let candidates = (inv.candidate_slugs || []).map((s) => getAccount(s)).filter(Boolean) as Account[];
  // The ticket's DevRev account may have been changed since (e.g. moved from VF to QC): follow it.
  let switched: string | null = null;
  const nowScope = await getTicket(inv.ticket_id).then((t) => resolveScope(t.account?.id, inv.ticket_display, t.account?.display_name)).catch(() => null);
  if (nowScope && (nowScope.account.slug !== inv.account_slug || nowScope.candidates.map((c) => c.slug).join() !== (inv.candidate_slugs || []).join())) {
    if (nowScope.account.slug !== inv.account_slug) switched = `${account?.name ?? inv.account_slug} → ${nowScope.account.name}`;
    account = nowScope.account; candidates = nowScope.candidates;
    await q(`UPDATE investigations SET account_slug=$2, candidate_slugs=$3 WHERE id=$1`, [id, account.slug, candidates.map((c) => c.slug)]);
  }
  if (!account) throw new Error(`account ${inv.account_slug} is no longer in config`);
  if (account.client_active === false) throw new Error(`${account.name} is an inactive client — turn it on in Admin → Clients to investigate its tickets`);

  const [{ next }] = await q<{ next: number }>(`SELECT COALESCE(max(seq), -1) + 1 AS next FROM investigation_steps WHERE investigation_id=$1`, [id]);
  // Claim the chat in one step (two messages at once can't both start the agent).
  const claimed = await q(`UPDATE investigations SET chat_running=true WHERE id=$1 AND status <> 'running' AND NOT chat_running RETURNING id`, [id]);
  if (!claimed.length) throw new LockedError("The agent is still working on this ticket — wait for it to finish.");
  await step(id, next, "user_message", null, { by, files: files.map(({ id, name, type, size }) => ({ id, name, type, size })) }, text);
  if (switched) await step(id, next + 1, "system", null, { account: account.slug }, `Ticket account changed (${switched}) — the agent now uses ${account.name}'s logs and database`).catch(() => {});
  const fileBlocks = files.length ? await uploadedFileBlocks(files) : [];
  // Replies (and their attachments) added to the ticket since the agent last looked: the investigation read the
  // ticket once, so without this a chat would answer from an outdated conversation.
  const [{ since }] = await q<{ since: string }>(
    `SELECT COALESCE((SELECT max(created_at) FROM investigation_steps WHERE investigation_id=$1 AND kind='user_message' AND seq < $2),
                     (SELECT started_at FROM agent_runs WHERE investigation_id=$1 ORDER BY id LIMIT 1),
                     (SELECT created_at FROM investigations WHERE id=$1)) AS since`, [id, next]);
  const fresh = (await listTimeline(inv.ticket_id).then(withEmailSenders).catch(() => [])).filter((c) => new Date(c.created_date) > new Date(since));
  const freshAtts = fresh.length ? await listAttachments(fresh).catch(() => []) : [];
  const freshBlocks = freshAtts.length ? await agentAttachmentBlocks(freshAtts) : [];
  const freshText = fresh.length
    ? `\n\n## New on the ticket since you last looked (${fresh.length} comment(s), oldest first — read them; they may change the answer)\n` +
      fresh.slice().reverse().map((c) => `[${c.created_date}] (${c.visibility}) ${c.created_by?.display_name || c.created_by?.email || "?"}: ${clip(c.body || "", 15000)}`).join("\n\n") +
      (freshAtts.length ? `\nNew attachments: ${freshAtts.filter((a) => !a.signature).map((a) => a.name).join(", ")} — included below.` : "")
    : "";

  const followUp =
    (switched ? `NOTE: the ticket's account was changed (${switched}). Your connections are now ${account.name}'s${candidates.length > 1 ? ` (plus ${candidates.filter((c) => c.slug !== account!.slug).map((c) => c.name).join(", ")})` : ""} — see the updated Account scope. Re-run the checks there.\n\n` : "") +
    `Follow-up from reviewer "${by}" on ${inv.ticket_display}:\n\n${text || "(no message — see the attached files)"}\n\n` +
    (files.length ? `They attached ${files.length} file(s): ${files.map((f) => f.name).join(", ")} — included below; read them.\n\n` : "") +
    (freshText ? freshText.trim() + "\n\n" : "") +
    `How to handle this message:\n` +
    `- Facts you already established in this conversation (with their request ids / query results) stay established — reuse them; don't re-run those checks.\n` +
    `- Run NEW log / DB / code checks only for what isn't verified yet: a new question, something you marked "still open", new comments or files above, or something the reviewer explicitly asks you to re-check ("re-check", "verify again", "is it still…").\n` +
    `- If the message is an acknowledgement or asks you to confirm what you found, answer straight away from the evidence you already have (quote it) — no new checks.\n` +
    `- Only if the findings change the RCA (including Current status), call submit_rca again with the FULL revised RCA.\n\n` +
    CHAT_REPLY_STYLE;
  // Without the saved conversation (none yet, or wiped by a redeploy), start a fresh one that carries the ticket, the
  // current RCA and the chat so far — so the agent still knows what was already established.
  const reseeded = async (): Promise<SDKUserMessage> => {
    const ticket = await getTicket(inv.ticket_id);
    const comments = await listTimeline(inv.ticket_id).then(withEmailSenders).catch(() => []);
    const earlier = (await q<{ kind: string; output: string | null; input: { by?: string } | null }>(
      `SELECT kind, output, input FROM investigation_steps WHERE investigation_id=$1 AND seq < $2 AND kind IN ('user_message','text')
        ORDER BY seq DESC LIMIT 16`, [id, next])).reverse();
    const chat = earlier.length
      ? `\n\n## Earlier in this conversation (most recent last)\n` + earlier.map((r) => `${r.kind === "user_message" ? `Reviewer${r.input?.by ? ` (${r.input.by})` : ""}` : "You"}: ${clip(r.output ?? "", 1500)}`).join("\n\n")
      : "";
    return userMessage([{
      type: "text",
      text: `${ticketPrompt(ticket, comments)}\n\n## Current RCA draft (from the investigation)\n${inv.draft_rca ?? "(none)"}${chat}\n\n---\n${followUp}`,
    }, ...fileBlocks, ...freshBlocks]);
  };
  const resume = inv.session_id && sessionOnDisk(inv.session_id) ? inv.session_id : undefined;
  const message = resume ? userMessage([{ type: "text", text: followUp }, ...fileBlocks, ...freshBlocks]) : await reseeded();
  void (async () => {
    const seq = next + (switched ? 2 : 1);
    try {
      try {
        await runSession({ id, account: account!, candidates, seq, message, resume, kind: "chat", by });
      } catch (e) {
        // The saved conversation couldn't be resumed after all: once more, as a fresh one.
        if (!resume || !/conversation|session/i.test((e as Error).message)) throw e;
        console.warn(`[chat] #${id}: couldn't resume session (${(e as Error).message}) — starting a fresh one`);
        const [{ n }] = await q<{ n: number }>(`SELECT COALESCE(max(seq), -1) + 1 AS n FROM investigation_steps WHERE investigation_id=$1`, [id]);
        await runSession({ id, account: account!, candidates, seq: Math.max(seq, n), message: await reseeded(), kind: "chat", by });
      }
    } catch (e) {
      await step(id, next + 1, "system", null, { error: true }, `Chat failed: ${(e as Error).message}`).catch(() => {});
    } finally {
      await q(`UPDATE investigations SET chat_running=false WHERE id=$1`, [id]);
    }
  })();
}

type SessionOpts = { id: number; account: Account; candidates: Account[]; seq: number; message: SDKUserMessage; resume?: string; kind: "investigation" | "chat"; by?: string; attempt?: number };

/*
 * At most AGENT_MAX_PARALLEL agent runs (investigations + chat replies) at once — each is a Claude process plus its
 * tools, and many together can run the server out of memory. The rest wait their turn (said so in the trail) and
 * start by themselves; Cancel works while waiting too.
 */
const maxParallel = () => Math.max(1, Number(process.env.AGENT_MAX_PARALLEL) || 2);
let activeRuns = 0;
const waiting: (() => void)[] = [];
async function takeSlot(id: number, seq: number): Promise<number> {
  if (activeRuns < maxParallel()) { activeRuns++; return seq; }
  await step(id, seq++, "system", null, { waiting: true },
    `Waiting to start — ${activeRuns} other investigation(s) / chat replies are running. This starts by itself as soon as one finishes.`);
  const ac = new AbortController();
  running.set(id, ac);
  try {
    await new Promise<void>((resolve, reject) => {
      waiting.push(resolve);
      ac.signal.addEventListener("abort", () => {
        const i = waiting.indexOf(resolve);
        if (i >= 0) waiting.splice(i, 1);
        reject(new Error("Cancelled while waiting to start"));
      });
    });
  } finally {
    running.delete(id);
  }
  return seq; // the finished run handed its slot straight over (activeRuns unchanged)
}
function releaseSlot() {
  const next = waiting.shift();
  if (next) next(); else activeRuns--;
}

async function runSession(opts: SessionOpts) {
  const seq = await takeSlot(opts.id, opts.seq);
  try {
    return await runSessionNow({ ...opts, seq });
  } finally {
    releaseSlot();
  }
}

async function runSessionNow(opts: SessionOpts) {
  const { id, account, candidates } = opts;
  let seq = opts.seq;
  const scope = [account, ...candidates];
  const allowedLogTypes = new Set(scope.flatMap((a) => Object.values(a.opensearch_log_types)));
  // Shipsy app logs (MCP): only when an account in scope uses it, and only after the login is verified/renewed
  // here — otherwise mcp-remote would pop a browser window mid-investigation.
  const appLogAccounts = scope.filter((a) => a.app_log);
  const appLogProject = appLogAccounts.length ? appLogProjects().find((p) => p.name === appLogAccounts[0].app_log!.project) : undefined;
  let appLogReady = false;
  if (appLogProject) {
    const auth = await ensureAppLogAuth(appLogProject, opts.by);
    appLogReady = auth.ok;
    if (!auth.ok) await step(id, seq++, "connection_error", `mcp__${APP_LOG}__login`, { connection: `opensearch_mcp:${appLogProject.name}`, tag: "AUTH_FAILED" }, auth.message);
  }
  // Decided now, not mid-run: start only if some Claude sign-in can be tried (the main one or a fallback).
  const chain = chainFor(opts.by);
  if (chain.length && !chain.some((u) => !u.viaExtension || gatewayCarrier(opts.by, { vpnChecked: true }))) throw new Error(noRouteMessage(chain));
  const abort = new AbortController();
  running.set(id, abort);
  const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
  async function* prompt(): AsyncIterable<SDKUserMessage> {
    yield opts.message;
  }

  const stream = query({
    prompt: prompt(),
    options: {
      model: agentModel(),
      cwd: ROOT,
      ...(opts.resume && { resume: opts.resume }),
      systemPrompt: systemPrompt(account, candidates),
      settingSources: [], // self-contained: don't pull in ~/.claude settings / CLAUDE.md
      tools: [], // no built-in tools (no shell, no file edits) — only the MCP tools below
      mcpServers: {
        [OS_SERVER]: { type: "stdio", command: "uv", args: ["run", path.join(ROOT, "mcp/opensearch-logs/server.py")], env: userToolEnv(opts.by) },
        devresolve: buildToolServer({ investigationId: id, account, candidates, user: opts.by }),
        ...(appLogProject && appLogReady && {
          [APP_LOG]: { type: "stdio" as const, command: appLogProject.command, args: appLogProject.args,
            env: { ...userToolEnv(opts.by), MCP_REMOTE_CONFIG_DIR: appLogConfigDir(appLogProject, opts.by) } },
        }),
      },
      canUseTool: async (name, input) => {
        // Dev Resolve's own tools (in-process, read-only, scoped to this ticket) are always allowed. Allowed here rather
        // than via allowedTools, which skips this callback and makes the SDK print a warning on every run.
        if (name.startsWith("mcp__devresolve__")) return { behavior: "allow", updatedInput: input };
        if (name === `mcp__${OS_SERVER}__search_logs`) {
          const lt = String(input.log_type || "");
          if (!allowedLogTypes.has(lt)) return { behavior: "deny", message: `log_type must be one of ${[...allowedLogTypes].join(", ")} for this ticket` };
          return { behavior: "allow", updatedInput: input };
        }
        if (name === `mcp__${OS_SERVER}__list_log_types`) return { behavior: "allow", updatedInput: input };
        if (name.startsWith(`mcp__${APP_LOG}__`) && appLogProject) {
          const tool = name.split("__").pop()!;
          if (!appLogProject.read_only_tools.includes(tool)) return { behavior: "deny", message: `${tool} is not allowed — use ${appLogProject.read_only_tools.join(", ")} (read-only)` };
          const index = String(input.index ?? "");
          const owner = appLogAccounts.find((a) => indexAllowed(index, Object.values(a.app_log!.indices)) === null);
          if (!owner) {
            const all = appLogAccounts.flatMap((a) => Object.values(a.app_log!.indices));
            return { behavior: "deny", message: indexAllowed(index, all) ?? `index "${index}" is not one of this ticket's indices` };
          }
          const cos = [owner.app_log!.company].flat().filter(Boolean) as string[];
          const whs = owner.app_log!.warehouses ?? [];
          const q = JSON.stringify(input).toLowerCase();
          const scoped = cos.some((c) => q.includes(c.toLowerCase())) || whs.some((w) => q.includes(`"${w.toLowerCase()}"`));
          if (cos.length && (tool === "SearchIndexTool" || tool === "CountTool") && !scoped) {
            const f = cos.length > 1 ? `{"terms": {"company.keyword": ${JSON.stringify(cos)}}}` : `{"term": {"company.keyword": "${cos[0]}"}}`;
            return { behavior: "deny", message: `${index} is shared by several clients — add the filter ${f} to the query` };
          }
          return { behavior: "allow", updatedInput: input };
        }
        return { behavior: "deny", message: `${name} is not available in Dev Resolve` };
      },
      maxTurns: 60,
      abortController: abort,
      env: { ...userToolEnv(opts.by), ...claudeEnv(opts.by, id), CLAUDE_AGENT_SDK_CLIENT_APP: "dev-resolve/0.1.0" },
    },
  });

  let sessionSaved = false, sessionId = opts.resume;
  let claudeDown: string | null = null; // the session ended because Claude couldn't be reached → resume on the fallback
  const [run] = await q<{ id: number }>(`INSERT INTO agent_runs (investigation_id, kind, started_by) VALUES ($1,$2,$3) RETURNING id`, [id, opts.kind, opts.by ?? null]);
  try {
    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      // Claude switched to a fallback (or came back) during the last request: say so in the timeline.
      for (const t of takeRouteEvents(id)) await step(id, seq++, "system", null, { claude_route: true }, t);
      const sid = (msg as { session_id?: string }).session_id;
      if (sid) sessionId = sid;
      if (!sessionSaved && sid) {
        sessionSaved = true;
        await q(`UPDATE investigations SET session_id=$2 WHERE id=$1`, [id, sid]);
      }
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) await step(id, seq++, "text", null, undefined, block.text);
          if (block.type === "tool_use") {
            pending.set(block.id, { name: block.name, input: block.input as Record<string, unknown> });
            await step(id, seq++, "tool_call", block.name, block.input, null);
          }
        }
      } else if (msg.type === "user" && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (typeof block !== "object" || block.type !== "tool_result") continue;
          const call = pending.get(block.tool_use_id);
          const out = typeof block.content === "string" ? block.content : (block.content || []).map((c) => ("text" in c ? c.text : "")).join("\n");
          const tag = /VPN_REQUIRED|AUTH_FAILED|NOT_CONFIGURED/.exec(out)?.[0];
          if (tag && call) {
            await step(id, seq++, "connection_error", call.name, { connection: connectionFor(call.name, call.input, account), tag }, out.slice(0, 2000));
          } else {
            await step(id, seq++, "tool_result", call?.name ?? null, undefined, out.slice(0, 20000));
          }
        }
      } else if (msg.type === "result") {
        const cost = "total_cost_usd" in msg ? msg.total_cost_usd : 0;
        const mu = ("modelUsage" in msg ? msg.modelUsage : {}) as Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
        const sum = (k: "inputTokens" | "outputTokens" | "cacheReadInputTokens" | "cacheCreationInputTokens") => Object.values(mu).reduce((n, m) => n + (m[k] || 0), 0);
        await q(
          `UPDATE agent_runs SET finished_at=now(), num_turns=$2, cost_usd=$3, input_tokens=$4, output_tokens=$5,
                  cache_read_tokens=$6, cache_write_tokens=$7, model_usage=$8 WHERE id=$1`,
          [run.id, msg.num_turns, cost, sum("inputTokens"), sum("outputTokens"), sum("cacheReadInputTokens"), sum("cacheCreationInputTokens"), JSON.stringify(mu)],
        );
        // Chat turns add to the investigation's running cost / turn count.
        await q(`UPDATE investigations SET cost_usd=COALESCE(cost_usd,0)+$2, num_turns=COALESCE(num_turns,0)+$3 WHERE id=$1`, [id, cost, msg.num_turns]);
        const failText = msg.subtype === "success" ? (msg.is_error ? String(msg.result ?? "") : "") : ("errors" in msg ? (msg.errors as string[]).join("; ") : "");
        if (failText && CLAUDE_DOWN.test(failText) && !abort.signal.aborted) claudeDown = failText.slice(0, 300);
        else if (msg.subtype !== "success") await step(id, seq++, "system", null, { subtype: msg.subtype }, "Agent stopped before finishing");
        break; // one-shot turn: don't keep the streaming-input session open
      }
    }
  } catch (e) {
    if (abort.signal.aborted || !CLAUDE_DOWN.test((e as Error).message)) throw e;
    claudeDown = (e as Error).message.slice(0, 300);
  } finally {
    running.delete(id);
    for (const t of takeRouteEvents(id)) await step(id, seq++, "system", null, { claude_route: true }, t).catch(() => {});
  }
  if (!claudeDown) { endRun(id); return; }
  // Claude dropped mid-investigation: resume the same session (everything so far is kept) — the relay sends it to the
  // fallback. Twice at most, then give up with the reason.
  const attempt = (opts.attempt ?? 0) + 1;
  if (!sessionId || attempt > 2) { endRun(id); throw new Error(`Claude couldn't be reached: ${claudeDown}`); }
  await step(id, seq++, "system", null, { claude_route: true }, `The Claude connection dropped (${claudeDown.slice(0, 160)}) — resuming the same investigation where it stopped${chain.length > 1 ? " on the fallback" : ""}.`);
  return runSessionNow({ ...opts, seq, attempt, resume: sessionId,
    message: userMessage([{ type: "text", text: "The connection to Claude dropped in the middle of your work. Continue exactly where you left off — don't repeat checks you already finished." }]) });
}
