import "server-only";
import { getDevrevView } from "./config";
import { settings } from "./settings";

const BASE = () => settings.devrevApiUrl();

export class DevrevError extends Error {
  constructor(public status: number, public tag: "AUTH_FAILED" | "HTTP_ERROR" | "NETWORK", message: string) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = process.env.DEVREV_TOKEN?.trim();
  if (!token) throw new DevrevError(0, "AUTH_FAILED", "DEVREV_TOKEN is not set in .env.local");
  let res: Response;
  try {
    res = await fetch(`${BASE()}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch (e) {
    throw new DevrevError(0, "NETWORK", `Could not reach ${BASE()}: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new DevrevError(res.status, "AUTH_FAILED", `DevRev rejected DEVREV_TOKEN (HTTP ${res.status})`);
  }
  if (!res.ok) throw new DevrevError(res.status, "HTTP_ERROR", `DevRev ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export interface TicketSummary {
  id: string;
  display_id: string;
  title: string;
  stage?: { name?: string; display_name?: string; stage?: { id: string; name: string } };
  subtype?: string;
  custom_schema_fragments?: string[];
  severity?: string;
  created_date: string;
  modified_date?: string;
  account?: { id: string; display_name?: string };
  custom_fields?: Record<string, unknown>;
  body?: string;
  tags?: { tag: { name: string } }[];
  owned_by?: { display_name?: string; full_name?: string }[];
}

/*
 * Ticket scope mirrors DevRev's WMS "Support" view (config/projects.json → devrev_view):
 * subtype Support + support-workflow stages only (no resolved/closed, no backlog / project-style stages).
 * Resolved tickets and Project tickets will get their own endpoints later.
 */
function viewBase(accountIds?: string[]) {
  const v = getDevrevView();
  return {
    type: ["ticket"],
    ticket: { subtype: [v.subtype], ...(accountIds?.length && { account: accountIds }) },
    stage: { name: v.stages },
  };
}

let wmsParts: { at: number; ids: string[] } | null = null;
/** The WMS product + every part under it (DevRev's applies_to_part filter doesn't include children). Cached 1 h. */
export async function wmsPartIds(): Promise<string[]> {
  if (wmsParts && Date.now() - wmsParts.at < 60 * 60 * 1000) return wmsParts.ids;
  const root = getDevrevView().wms_product_id;
  const ids = [root];
  let cursor: string | undefined;
  do {
    const r = await call<{ parts: { id: string }[]; next_cursor?: string }>("/parts.list", { parent_part: { parts: [root] }, limit: 100, ...(cursor && { cursor }) });
    ids.push(...r.parts.map((p) => p.id));
    cursor = r.next_cursor;
  } while (cursor);
  wmsParts = { at: Date.now(), ids };
  return ids;
}

export async function listTickets(accountIds: string[], opts: { limit?: number; cursor?: string } = {}) {
  return call<{ works: TicketSummary[]; next_cursor?: string; prev_cursor?: string }>("/works.list", {
    ...viewBase(accountIds.length ? accountIds : undefined),
    limit: opts.limit ?? 25,
    sort_by: ["created_date:desc"],
    ...(opts.cursor && { cursor: opts.cursor }),
  });
}

const count = (body: Record<string, unknown>) => call<{ count: number }>("/works.count", body).then((r) => r.count);

export interface TicketCounts {
  account: { total: number; wms: number; default_part: number };
  org: { total: number; wms: number };
}

/**
 * total = all parts; wms = DevRev WMS view (part under WMS product); default_part = still on the default
 * TMS product part (new email tickets land there before triage, so some are really WMS).
 */
export async function ticketCounts(accountIds: string[]): Promise<TicketCounts> {
  const parts = await wmsPartIds();
  const def = getDevrevView().default_part_id;
  const [aTotal, aWms, aDef, oTotal, oWms] = await Promise.all([
    count(viewBase(accountIds)),
    count({ ...viewBase(accountIds), applies_to_part: parts }),
    count({ ...viewBase(accountIds), applies_to_part: [def] }),
    count(viewBase()),
    count({ ...viewBase(), applies_to_part: parts }),
  ]);
  return { account: { total: aTotal, wms: aWms, default_part: aDef }, org: { total: oTotal, wms: oWms } };
}

const countCache = new Map<string, { at: number; value: { total: number; wms: number } }>();
const COUNT_TTL_MS = 5 * 60 * 1000;

/** Per-account total + WMS-view counts for the account picker (cached 5 min, batched). */
export async function countsByAccount(accounts: { key: string; accountIds: string[] }[], force = false) {
  const out: Record<string, { total: number; wms: number }> = {};
  const parts = await wmsPartIds();
  const todo = accounts.filter((a) => {
    const hit = countCache.get(a.key);
    if (!force && hit && Date.now() - hit.at < COUNT_TTL_MS) { out[a.key] = hit.value; return false; }
    return a.accountIds.length > 0;
  });
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (a) => {
        const [total, wms] = await Promise.all([count(viewBase(a.accountIds)), count({ ...viewBase(a.accountIds), applies_to_part: parts })]);
        countCache.set(a.key, { at: Date.now(), value: { total, wms } });
        out[a.key] = { total, wms };
      }),
    );
  }
  return out;
}

export function devrevUrl(displayId: string) {
  return `${settings.devrevAppUrl()}/works/${displayId}`;
}

/** Accepts a display id (TKT-123) or a full DON. */
export async function getTicket(id: string) {
  const r = await call<{ work: TicketSummary }>("/works.get", { id });
  return r.work;
}

export interface TimelineEntry {
  id: string;
  type: string;
  body?: string;
  visibility?: string;
  created_date: string;
  created_by?: { display_name?: string; full_name?: string; email?: string; type?: string };
  via_email?: { from: string; to: string; cc: string }; // set by withEmailSenders: the real sender of a bot-imported email
  artifacts?: { id: string; display_id: string; file?: { name: string; size: number; type: string } }[];
}

/** Short-lived signed download URL for a DevRev artifact. */
export async function locateArtifact(id: string) {
  return (await call<{ url: string }>("/artifacts.locate", { id })).url;
}

/**
 * DevRev's own automation notices posted as comments ("Stage has been changed for …", owner / SLA / priority
 * updates). They come from service accounts; customer emails also arrive through a service account (the email
 * integration), so only short status-style messages or automation-named authors are dropped.
 */
function isDevrevNotice(e: TimelineEntry) {
  if (e.created_by?.type !== "service_account") return false;
  const who = e.created_by.display_name || "";
  if (/email/i.test(who)) return false;
  const body = (e.body || "").trim();
  return /update|notification|workflow|automation|:\s*$/i.test(who) ||
    (body.length < 500 && /\b(has been|was) (changed|updated|assigned|moved|set)\b|\bchanged (from|to)\b|\bSLA\b|\b(stage|owner|severity|priority|part|pod)\b.*\b(changed|updated)\b/i.test(body));
}

/** All comments on an object. Timeline pages also carry SLA/stage events, so follow cursors instead of trusting one page. */
export async function listTimeline(objectId: string, maxPages = 20) {
  const comments: TimelineEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const r = await call<{ timeline_entries: TimelineEntry[]; next_cursor?: string }>("/timeline-entries.list", {
      object: objectId,
      limit: 100,
      ...(cursor && { cursor }),
    });
    comments.push(...(r.timeline_entries || []).filter((e) => e.type === "timeline_comment" && !isDevrevNotice(e)));
    cursor = r.next_cursor;
    if (!cursor) break;
  }
  return comments;
}

/**
 * Posts to the ticket's INTERNAL discussion. DevRev defaults comments to
 * external (customer-visible), so visibility is always set explicitly here and
 * there is deliberately no parameter to change it.
 */
export async function postInternalComment(objectDon: string, markdown: string) {
  const r = await call<{ timeline_entry: TimelineEntry }>("/timeline-entries.create", {
    object: objectDon,
    type: "timeline_comment",
    body: markdown,
    body_type: "text",
    visibility: "internal",
  });
  return r.timeline_entry;
}

export async function whoAmI() {
  return call<{ dev_user: { display_name: string; email: string } }>("/dev-users.self");
}

/** DevRev accounts matching a name (admin: picking a client's DevRev accounts). */
export async function searchAccounts(query: string) {
  const r = await call<{ results?: { account?: { id: string; display_name: string; external_refs?: string[] } }[] }>(
    "/search.hybrid", { query, namespace: "account", limit: 15 });
  return (r.results || []).map((x) => x.account).filter((a): a is { id: string; display_name: string } => !!a?.id);
}

export interface StageOption { id: string; name: string; final: boolean }
type Diagram = { name: string; is_default: boolean; stages: { stage: { id: string; name: string; state?: { is_final?: boolean } }; transitions: { target_stage: { id: string } }[] }[] };
let diagrams: { at: number; list: Diagram[] } | null = null;

/** The ticket stage diagram for a subtype (e.g. "implementation_subtype_stage_diagram"), else DevRev's default. Cached 1 h. */
async function ticketDiagram(subtype?: string) {
  if (!diagrams || Date.now() - diagrams.at > 60 * 60 * 1000) {
    const list: Diagram[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await call<{ result: Diagram[]; next_cursor?: string }>(`/stage-diagrams.list?leaf_type=ticket&limit=50${cursor ? `&cursor=${cursor}` : ""}`);
      list.push(...r.result);
      cursor = r.next_cursor;
      if (!cursor) break;
    }
    diagrams = { at: Date.now(), list };
  }
  const key = (subtype || "").toLowerCase();
  return diagrams.list.find((d) => key && d.name.toLowerCase().startsWith(`${key}_subtype`)) ?? diagrams.list.find((d) => d.is_default) ?? diagrams.list[0];
}

/** Stages a ticket can move to from its current stage (DevRev refuses anything else). */
export async function stageMoves(subtype: string | undefined, fromStageId: string | undefined): Promise<StageOption[]> {
  const d = await ticketDiagram(subtype);
  if (!d) return [];
  const byId = new Map(d.stages.map((x) => [x.stage.id, x.stage]));
  const from = d.stages.find((x) => x.stage.id === fromStageId);
  const ids = from ? from.transitions.map((t) => t.target_stage.id) : d.stages.map((x) => x.stage.id);
  return ids.map((id) => byId.get(id)).filter(Boolean).map((st) => ({ id: st!.id, name: st!.name, final: !!st!.state?.is_final }));
}

let podField: { at: number; values: string[] } | null = null;
/** Allowed Pod values (the tenant "pod" enum field), read from the ticket's own schema fragments. Cached 1 h. */
export async function podValues(sample: TicketSummary): Promise<string[]> {
  if (podField && Date.now() - podField.at < 60 * 60 * 1000) return podField.values;
  for (const frag of (sample.custom_schema_fragments || []).filter((f) => f.includes(":tenant_fragment/"))) {
    const r = await call<{ fragment: { fields?: { name: string; allowed_values?: string[] }[] } }>(`/schemas.custom.get?id=${encodeURIComponent(frag)}`);
    const f = r.fragment.fields?.find((x) => x.name === "pod");
    if (f?.allowed_values?.length) { podField = { at: Date.now(), values: f.allowed_values }; return f.allowed_values; }
  }
  return [];
}

/** Moves a ticket to another stage, sets its Pod (null clears it) and/or other custom fields (keys with their tnt__/ctype__ prefix). */
export async function updateTicket(id: string, change: { stageId?: string; pod?: string | null; fields?: Record<string, unknown> }) {
  const custom = { ...(change.fields ?? {}), ...(change.pod !== undefined && { tnt__pod: change.pod }) };
  const r = await call<{ work: TicketSummary }>("/works.update", {
    id, type: "ticket",
    ...(change.stageId && { stage: { stage: change.stageId } }),
    ...(Object.keys(custom).length && { custom_fields: custom }),
  });
  return r.work;
}

const revUsers = new Map<string, { name?: string; email?: string }>();
/** A customer contact (rev user) by DON — used to name the sender of an email the integration bot imported. */
export async function revUser(id: string) {
  if (revUsers.has(id)) return revUsers.get(id)!;
  const r = await call<{ rev_user: { display_name?: string; full_name?: string; email?: string } }>(`/rev-users.get?id=${encodeURIComponent(id)}`).catch(() => null);
  const u = { name: r?.rev_user.full_name || r?.rev_user.display_name, email: r?.rev_user.email };
  revUsers.set(id, u);
  return u;
}

export interface DevUser { id: string; name: string; email?: string }
let devUserCache: { at: number; list: DevUser[] } | null = null;
/** Active DevRev users (for picking a CX Lead). ~hundreds, so loaded once and searched in the browser. Cached 1 h. */
export async function devUsers(): Promise<DevUser[]> {
  if (devUserCache && Date.now() - devUserCache.at < 60 * 60 * 1000) return devUserCache.list;
  const list: DevUser[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 30; i++) {
    const r = await call<{ dev_users: { id: string; display_name?: string; full_name?: string; email?: string }[]; next_cursor?: string }>(
      `/dev-users.list?limit=100&state=active${cursor ? `&cursor=${cursor}` : ""}`);
    list.push(...r.dev_users.map((u) => ({ id: u.id, name: u.full_name || u.display_name || u.email || u.id, email: u.email })));
    cursor = r.next_cursor;
    if (!cursor) break;
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  devUserCache = { at: Date.now(), list };
  return list;
}

export interface ResolveField { key: string; label: string; type: "user" | "enum" | "text"; options?: string[] }
/** Fields the team fills when resolving a ticket (DevRev names, without prefix). Override with DEVREV_RESOLVE_FIELDS. */
const RESOLVE_FIELDS = () => (process.env.DEVREV_RESOLVE_FIELDS || "assignee,friday_review,root_cause_and_resolution_details,resolution,resolved_by")
  .split(",").map((x) => x.trim()).filter(Boolean);
let resolveCache: { at: number; fields: ResolveField[] } | null = null;
/** The resolve-time fields with their labels, types and choices, read from the ticket's schema fragments. Cached 1 h. */
export async function resolveFields(sample: TicketSummary): Promise<ResolveField[]> {
  if (resolveCache && Date.now() - resolveCache.at < 60 * 60 * 1000) return resolveCache.fields;
  const want = RESOLVE_FIELDS();
  const found = new Map<string, ResolveField>();
  for (const frag of sample.custom_schema_fragments || []) {
    const prefix = frag.includes(":tenant_fragment/") ? "tnt__" : frag.includes(":custom_type_fragment/") ? "ctype__" : null;
    if (!prefix) continue;
    const r = await call<{ fragment: { fields?: { name: string; field_type: string; id_type?: string[]; allowed_values?: string[]; ui?: { display_name?: string } }[] } }>(
      `/schemas.custom.get?id=${encodeURIComponent(frag)}`);
    for (const f of r.fragment.fields ?? []) {
      if (!want.includes(f.name) || found.has(f.name)) continue;
      const type = f.field_type === "id" && f.id_type?.includes("devu") ? "user" : f.field_type === "enum" ? "enum" : "text";
      found.set(f.name, { key: prefix + f.name, label: f.ui?.display_name || f.name, type, ...(f.allowed_values && { options: f.allowed_values }) });
    }
  }
  const fields = want.map((n) => found.get(n)).filter(Boolean) as ResolveField[];
  resolveCache = { at: Date.now(), fields };
  return fields;
}
