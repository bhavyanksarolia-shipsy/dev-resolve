import "server-only";
import { simpleParser, type ParsedMail } from "mailparser";
import { locateArtifact, type TimelineEntry } from "./devrev";

export interface Attachment {
  artifact_id: string;          // DevRev artifact DON
  part?: number;                // set when this is a file inside an email.eml
  name: string;
  type: string;
  size: number;
  comment_id: string;
  comment_date: string;
  visibility?: string;
  from?: string;
  kind: "image" | "email" | "file";
  url: string;                  // Dev Resolve proxy URL (DevRev signed URLs expire)
}

const emlCache = new Map<string, { at: number; mail: ParsedMail }>();
const EML_TTL_MS = 30 * 60 * 1000;

async function download(artifactId: string): Promise<Buffer> {
  const url = await locateArtifact(artifactId);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`artifact download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function parseEmail(artifactId: string): Promise<ParsedMail> {
  const hit = emlCache.get(artifactId);
  if (hit && Date.now() - hit.at < EML_TTL_MS) return hit.mail;
  const mail = await simpleParser(await download(artifactId));
  emlCache.set(artifactId, { at: Date.now(), mail });
  return mail;
}

export async function fetchArtifact(artifactId: string, part?: number): Promise<{ body: Buffer; type: string; name: string }> {
  if (part == null) return { body: await download(artifactId), type: "application/octet-stream", name: "" };
  const mail = await parseEmail(artifactId);
  const p = mail.attachments[part];
  if (!p) throw new Error("no such part");
  return { body: p.content, type: p.contentType, name: p.filename || `part-${part}` };
}

const kindOf = (type: string, name: string): Attachment["kind"] =>
  type.startsWith("image/") ? "image" : type === "message/rfc822" || name.endsWith(".eml") ? "email" : "file";

/**
 * Every attachment on the ticket's comments. Email tickets carry the raw email.eml; DevRev usually also
 * extracts its images as separate artifacts, so .eml parts are only listed when not already attached directly.
 */
export async function listAttachments(comments: TimelineEntry[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  const seen = new Set<string>();
  const emails: { a: NonNullable<TimelineEntry["artifacts"]>[number]; c: TimelineEntry }[] = [];
  for (const c of comments) {
    for (const a of c.artifacts || []) {
      const name = a.file?.name || a.display_id;
      const type = a.file?.type || "application/octet-stream";
      const kind = kindOf(type, name);
      out.push({
        artifact_id: a.id, name, type, size: a.file?.size ?? 0, comment_id: c.id, comment_date: c.created_date,
        visibility: c.visibility, from: c.created_by?.display_name || c.created_by?.email, kind,
        url: kind === "email" ? `/api/artifacts/email?id=${encodeURIComponent(a.id)}` : `/api/artifacts/file?id=${encodeURIComponent(a.id)}`,
      });
      seen.add(`${name}|${a.file?.size ?? 0}`);
      if (kind === "email") emails.push({ a, c });
    }
  }
  for (const { a, c } of emails) {
    try {
      const mail = await parseEmail(a.id);
      mail.attachments.forEach((p, i) => {
        const name = p.filename || `part-${i}`;
        if (seen.has(`${name}|${p.size}`)) return;
        seen.add(`${name}|${p.size}`);
        out.push({
          artifact_id: a.id, part: i, name, type: p.contentType, size: p.size, comment_id: c.id, comment_date: c.created_date,
          visibility: c.visibility, from: c.created_by?.display_name || c.created_by?.email, kind: kindOf(p.contentType, name),
          url: `/api/artifacts/file?id=${encodeURIComponent(a.id)}&part=${i}`,
        });
      });
    } catch {
      /* unreadable email — still listed as the .eml itself */
    }
  }
  return out;
}

/** Images (and text-like files) to hand the agent, within the API's per-image size limit. */
export async function agentAttachmentBlocks(atts: Attachment[], maxImages = 8) {
  type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  const blocks: ({ type: "image"; source: { type: "base64"; media_type: ImageType; data: string } } | { type: "text"; text: string })[] = [];
  const supported: string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  let images = 0;
  for (const a of atts) {
    try {
      if (a.kind === "image" && supported.includes(a.type) && a.size < 3_500_000 && images < maxImages) {
        const { body } = await fetchArtifact(a.artifact_id, a.part);
        blocks.push({ type: "text", text: `Attachment "${a.name}" (from ${a.from ?? "?"}, ${a.comment_date}):` });
        blocks.push({ type: "image", source: { type: "base64", media_type: a.type as ImageType, data: body.toString("base64") } });
        images++;
      } else if (/^text\/(plain|csv)/.test(a.type) && a.size < 200_000) {
        const { body } = await fetchArtifact(a.artifact_id, a.part);
        blocks.push({ type: "text", text: `Attachment "${a.name}":\n${body.toString("utf8").slice(0, 20000)}` });
      }
    } catch {
      blocks.push({ type: "text", text: `Attachment "${a.name}" could not be downloaded.` });
    }
  }
  return blocks;
}
