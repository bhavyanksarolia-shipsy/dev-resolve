import "server-only";
import { getDevrevView } from "./config";

const BASE = (process.env.DEVREV_BASE_URL || "https://api.devrev.ai").replace(/\/$/, "");

export class DevrevError extends Error {
  constructor(public status: number, public tag: "AUTH_FAILED" | "HTTP_ERROR" | "NETWORK", message: string) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = process.env.DEVREV_TOKEN;
  if (!token) throw new DevrevError(0, "AUTH_FAILED", "DEVREV_TOKEN is not set in .env.local");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch (e) {
    throw new DevrevError(0, "NETWORK", `Could not reach ${BASE}: ${(e as Error).message}`);
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
  stage?: { name?: string; display_name?: string };
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
  return `${(process.env.DEVREV_APP_URL || "https://app.devrev.ai/shipsy").replace(/\/$/, "")}/works/${displayId}`;
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
  artifacts?: { id: string; display_id: string; file?: { name: string; size: number; type: string } }[];
}

/** Short-lived signed download URL for a DevRev artifact. */
export async function locateArtifact(id: string) {
  return (await call<{ url: string }>("/artifacts.locate", { id })).url;
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
    comments.push(...(r.timeline_entries || []).filter((e) => e.type === "timeline_comment"));
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
