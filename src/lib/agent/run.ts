import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Account, ROOT, getAccount, projectForLogType, resolveDevrevAccount, toolEnv } from "../config";
import { q } from "../db";
import { getTicket, listTimeline } from "../devrev";
import { accountKnowledge } from "../knowledge";
import { agentAttachmentBlocks, listAttachments } from "../attachments";
import { buildToolServer } from "./tools";
import { appLogConfigDir, appLogProjects, ensureAppLogAuth, indexAllowed } from "../applog";

const MODEL = process.env.DEV_RESOLVE_MODEL || "claude-opus-5-5";
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

function skillText(account: Account) {
  return (account.skills || [])
    .map((s) => path.join(ROOT, ".claude/skills", s, "SKILL.md"))
    .filter(existsSync)
    .map((f) => `## Skill: ${path.basename(path.dirname(f))}\n${readFileSync(f, "utf8")}`)
    .join("\n\n");
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
  return `You are Dev Resolve, a senior StockOne WMS support engineer producing a root-cause analysis (RCA) for a DevRev ticket.
Work like an investigator: evidence first, conclusions second. Never guess.

# Account scope
${candidates.length > 1 ? `The ticket's DevRev account is ambiguous. Work out which of these tenants it belongs to FIRST (warehouse codes, identifiers — probe each one's logs/DB), then set resolved_account_slug in submit_rca.\n` : ""}${conn}

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
- mcp__devresolve__similar_cases — previously resolved tickets for this account. Check early.
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
   2. **Every gate-in with GP8 was rejected "appointment already in use"**, 27 Sep 10:42 → 29 Sep 09:15, 5 attempts — audit logs, request id \`abc123\`
   Include timestamps and request ids. No raw SQL or query syntax — the reviewer can see the exact queries in the trail.)
## Root cause  (the code path file:line and condition, or the upstream system, with proof)
## Current status  (state of the data RIGHT NOW vs. what was reported: still broken / fixed manually by whom & when /
   recovered automatically / partially — with the query result that shows it, and whether it can recur)
## Fix / next step  (data fix / code fix / config / upstream team, and owner)
## Confidence  (high/medium/low + what could not be verified)
## Suggested customer reply  (short, no internal system names. State facts and current status only. NEVER mention or
   imply fixes, improvements, product changes, alerts or timelines ("we're improving…", "we'll add…", "this will be fixed") —
   those need team sign-off first. Recommended fixes belong only in the internal "Fix / next step" section.)

# Knowledge base (curated — prefer it over assumptions, but lines marked Unverified must be checked)
${accountKnowledge(account)}

${skillText(account)}`;
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

function resolveScope(accountId: string | undefined, displayId: string, accountName?: string) {
  const res = resolveDevrevAccount(accountId);
  let account: Account | undefined;
  let candidates: Account[] = [];
  if (res.kind === "account") account = res.account;
  else if (res.kind === "ambiguous") {
    candidates = res.candidates;
    account = candidates[0];
  }
  if (!account) throw new Error(`Ticket ${displayId}'s DevRev account (${accountName ?? "none"}) is not mapped in config/projects.json`);
  return { account, candidates };
}

export async function startInvestigation(ticketRef: string, startedBy = "unknown"): Promise<number> {
  const ticket = await getTicket(ticketRef);
  const { account, candidates } = resolveScope(ticket.account?.id, ticket.display_id, ticket.account?.display_name);
  const [row] = await q<{ id: number }>(
    `INSERT INTO investigations (ticket_id, ticket_display, ticket_title, account_slug, status, candidate_slugs, started_by)
     VALUES ($1,$2,$3,$4,'running',$5,$6) RETURNING id`,
    [ticket.id, ticket.display_id, ticket.title, account.slug, candidates.map((c) => c.slug), startedBy],
  );
  void runAgent(row.id, ticket, account, candidates, startedBy).catch(async (e) => {
    await q(`UPDATE investigations SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [row.id, String(e?.message || e)]);
  });
  return row.id;
}

export function cancelInvestigation(id: number) {
  running.get(id)?.abort();
}

const userMessage = (content: SDKUserMessage["message"]["content"]): SDKUserMessage =>
  ({ type: "user", parent_tool_use_id: null, message: { role: "user", content } }) as SDKUserMessage;

async function runAgent(id: number, ticket: Awaited<ReturnType<typeof getTicket>>, account: Account, candidates: Account[], startedBy?: string) {
  const comments = await listTimeline(ticket.id).catch(() => []);
  // Screenshots / files the customer attached (incl. images inside email.eml) go to the agent as real images.
  const attachments = await listAttachments(comments).catch(() => []);
  const attachmentBlocks = await agentAttachmentBlocks(attachments);
  const attachmentList = attachments.length
    ? `\n\n## Attachments on the ticket (${attachments.filter((a) => !a.signature).length})\n` +
      attachments.filter((a) => !a.signature).map((a) => `- ${a.name} (${a.type}, ${Math.round(a.size / 1024)} KB, from ${a.from ?? "?"})`).join("\n") +
      "\nImages, PDFs, emails and the contents of Excel / Word / text files are included below — read them: they often hold the exact error screen, identifiers (invoice, order, SKU lists) and times."
    : "";
  let seq = 0;
  await step(id, seq++, "system", null, { model: MODEL, account: account.slug, candidates: candidates.map((c) => c.slug) }, `Investigating ${ticket.display_id} as ${account.name}`);
  if (attachments.length) {
    const imgs = attachmentBlocks.filter((b) => b.type === "image").length;
    const emails = attachmentBlocks.filter((b) => b.type === "text" && b.text.startsWith("Attached email")).length;
    const docs = attachmentBlocks.filter((b) => b.type === "document").length;
    const files = attachmentBlocks.filter((b) => b.type === "text" && b.text.startsWith("Attached file")).length;
    await step(id, seq++, "system", null, { attachments: attachments.map((a) => a.name) }, `Read ${attachments.length} attachment(s) · ${imgs} image(s), ${docs} PDF(s), ${emails} email(s), ${files} file(s) sent to the agent${attachments.some((a) => a.signature) ? ` (${attachments.filter((a) => a.signature).length} signature logo(s) skipped)` : ""}`);
  }
  await runSession({
    id, account, candidates, seq,
    message: userMessage([{ type: "text", text: ticketPrompt(ticket, comments) + attachmentList }, ...attachmentBlocks]),
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
export async function sendChatMessage(id: number, text: string, by = "unknown") {
  const [inv] = await q<{
    ticket_id: string; ticket_display: string; account_slug: string; candidate_slugs: string[] | null;
    status: string; session_id: string | null; chat_running: boolean; draft_rca: string | null;
  }>(`SELECT * FROM investigations WHERE id=$1`, [id]);
  if (!inv) throw new Error("investigation not found");
  if (inv.status === "running" || inv.chat_running) throw new Error("The agent is still working on this ticket — wait for it to finish.");
  const account = getAccount(inv.account_slug);
  if (!account) throw new Error(`account ${inv.account_slug} is no longer in config`);
  const candidates = (inv.candidate_slugs || []).map((s) => getAccount(s)).filter(Boolean) as Account[];

  const [{ next }] = await q<{ next: number }>(`SELECT COALESCE(max(seq), -1) + 1 AS next FROM investigation_steps WHERE investigation_id=$1`, [id]);
  await q(`UPDATE investigations SET chat_running=true WHERE id=$1`, [id]);
  await step(id, next, "user_message", null, { by }, text);

  const followUp =
    `Follow-up from reviewer "${by}" on ${inv.ticket_display}:\n\n${text}\n\n` +
    `Answer them directly and concisely. Run any log / DB / code checks needed to verify — don't answer from memory when the data can be checked. ` +
    `If the findings change the RCA (including Current status), call submit_rca again with the FULL revised RCA; otherwise just reply.`;
  let message: SDKUserMessage;
  if (inv.session_id) {
    message = userMessage([{ type: "text", text: followUp }]);
  } else {
    // Investigations created before chat existed have no saved session: re-seed with the ticket + current RCA.
    const ticket = await getTicket(inv.ticket_id);
    const comments = await listTimeline(inv.ticket_id).catch(() => []);
    message = userMessage([{
      type: "text",
      text: `${ticketPrompt(ticket, comments)}\n\n## Current RCA draft (from an earlier investigation)\n${inv.draft_rca ?? "(none)"}\n\n---\n${followUp}`,
    }]);
  }
  void (async () => {
    try {
      await runSession({ id, account, candidates, seq: next + 1, message, resume: inv.session_id ?? undefined, kind: "chat", by });
    } catch (e) {
      await step(id, next + 1, "system", null, { error: true }, `Chat failed: ${(e as Error).message}`).catch(() => {});
    } finally {
      await q(`UPDATE investigations SET chat_running=false WHERE id=$1`, [id]);
    }
  })();
}

async function runSession(opts: { id: number; account: Account; candidates: Account[]; seq: number; message: SDKUserMessage; resume?: string; kind: "investigation" | "chat"; by?: string }) {
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
    const auth = await ensureAppLogAuth(appLogProject);
    appLogReady = auth.ok;
    if (!auth.ok) await step(id, seq++, "connection_error", `mcp__${APP_LOG}__login`, { connection: `opensearch_mcp:${appLogProject.name}`, tag: "AUTH_FAILED" }, auth.message);
  }
  const abort = new AbortController();
  running.set(id, abort);
  const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
  async function* prompt(): AsyncIterable<SDKUserMessage> {
    yield opts.message;
  }

  const stream = query({
    prompt: prompt(),
    options: {
      model: MODEL,
      cwd: ROOT,
      ...(opts.resume && { resume: opts.resume }),
      systemPrompt: systemPrompt(account, candidates),
      settingSources: [], // self-contained: don't pull in ~/.claude settings / CLAUDE.md
      tools: [], // no built-in tools (no shell, no file edits) — only the MCP tools below
      mcpServers: {
        [OS_SERVER]: { type: "stdio", command: "uv", args: ["run", path.join(ROOT, "mcp/opensearch-logs/server.py")], env: toolEnv() },
        devresolve: buildToolServer({ investigationId: id, account, candidates }),
        ...(appLogProject && appLogReady && {
          [APP_LOG]: { type: "stdio" as const, command: appLogProject.command, args: appLogProject.args,
            env: { ...toolEnv(), MCP_REMOTE_CONFIG_DIR: appLogConfigDir(appLogProject) } },
        }),
      },
      allowedTools: ["mcp__devresolve__*"],
      canUseTool: async (name, input) => {
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
      env: { ...toolEnv(), CLAUDE_AGENT_SDK_CLIENT_APP: "dev-resolve/0.1.0" },
    },
  });

  let sessionSaved = false;
  const [run] = await q<{ id: number }>(`INSERT INTO agent_runs (investigation_id, kind, started_by) VALUES ($1,$2,$3) RETURNING id`, [id, opts.kind, opts.by ?? null]);
  try {
    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      const sid = (msg as { session_id?: string }).session_id;
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
        if (msg.subtype !== "success") await step(id, seq++, "system", null, { subtype: msg.subtype }, "Agent stopped before finishing");
        break; // one-shot turn: don't keep the streaming-input session open
      }
    }
  } finally {
    running.delete(id);
  }
}
