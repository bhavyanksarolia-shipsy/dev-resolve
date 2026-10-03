import "server-only";
import { listTimeline } from "./devrev";
import { listAttachments, withEmailSenders } from "./attachments";

/**
 * A ticket's comments + attachments. DevRev takes seconds to list them, so they're cached per ticket until the
 * ticket's modified time changes (10 min at most). Posting a comment from Dev Resolve clears it (forgetConversation).
 */
type Conversation = { timeline: Awaited<ReturnType<typeof listTimeline>>; attachments: Awaited<ReturnType<typeof listAttachments>> };
const conversations = new Map<string, { modified: string; at: number; value: Promise<Conversation> }>();
const CONV_TTL_MS = 10 * 60 * 1000;

async function loadConversation(ticketId: string): Promise<Conversation> {
  const timeline = await listTimeline(ticketId).catch(() => []);
  // Senders and attachments both read the attached emails — run together (one download each, see parseEmail).
  const [, attachments] = await Promise.all([withEmailSenders(timeline).catch(() => timeline), listAttachments(timeline).catch(() => [])]);
  return { timeline, attachments };
}

export function conversation(ticketId: string, modified: string, force = false) {
  const hit = conversations.get(ticketId);
  if (!force && hit && hit.modified === modified && Date.now() - hit.at < CONV_TTL_MS) return hit.value;
  const value = loadConversation(ticketId);
  value.catch(() => conversations.delete(ticketId));
  conversations.set(ticketId, { modified, at: Date.now(), value });
  if (conversations.size > 300) conversations.delete(conversations.keys().next().value!);
  return value;
}


export function forgetConversation(ticketId: string) {
  conversations.delete(ticketId);
}
