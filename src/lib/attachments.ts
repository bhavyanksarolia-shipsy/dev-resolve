import "server-only";
import { simpleParser, type ParsedMail } from "mailparser";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
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
  signature?: boolean;          // email-signature logo / emoji (repeated small inline image) — hidden, not sent to the agent
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
  // Signature logos: small images that are Outlook inline emoji / imageNNN, or the same small image repeated across replies.
  const sizeCount = new Map<number, number>();
  for (const a of out) if (a.kind === "image") sizeCount.set(a.size, (sizeCount.get(a.size) ?? 0) + 1);
  for (const a of out) {
    if (a.kind !== "image" || a.size > 40_000) continue;
    // Outlook also names real pasted screenshots imageNNN.png, so for those only tiny icons count as logos.
    if (/^OutlookEmoji-/i.test(a.name) || (/^image\d{3}\./i.test(a.name) && a.size <= 12_000) || (sizeCount.get(a.size) ?? 0) >= 3) a.signature = true;
  }
  return out;
}

/** Minimal HTML → text for email bodies that have no plain-text part. */
function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
const isPdf = (a: Attachment) => a.type === "application/pdf" || ext(a.name) === "pdf";
const SHEET_EXT = ["xlsx", "xlsm", "xls", "xlsb", "ods", "csv", "tsv"];
const TEXT_EXT = ["txt", "log", "json", "xml", "html", "htm", "md", "yaml", "yml", "sql"];

/** Plain text of a spreadsheet / Word / text-like file, or null when it isn't one of those. */
async function fileText(a: Attachment, body: Buffer): Promise<string | null> {
  const e = ext(a.name);
  if (SHEET_EXT.includes(e) || /spreadsheet|excel|text\/csv/.test(a.type)) {
    const wb = XLSX.read(body, { type: "buffer", cellDates: true, dense: true });
    return wb.SheetNames.map((n) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false });
      const rows = csv.split("\n").length;
      return `### Sheet "${n}" (${rows} rows)\n${csv}`;
    }).join("\n\n");
  }
  if (e === "docx" || a.type.includes("wordprocessingml")) return (await mammoth.extractRawText({ buffer: body })).value;
  if (TEXT_EXT.includes(e) || a.type.startsWith("text/") || a.type === "application/json") {
    const t = body.toString("utf8");
    return e === "html" || e === "htm" || a.type === "text/html" ? htmlToText(t) : t;
  }
  return null;
}

/** Images, PDFs, attached emails and spreadsheets / Word / text files (as text) to hand the agent. */
export async function agentAttachmentBlocks(atts: Attachment[], maxImages = 8, maxPdfs = 5) {
  type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  const blocks: (
    | { type: "image"; source: { type: "base64"; media_type: ImageType; data: string } }
    | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title?: string }
    | { type: "text"; text: string }
  )[] = [];
  const supported: string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  let images = 0;
  let emailBudget = 150_000; // total characters of email text per investigation
  let fileBudget = 150_000;  // total characters of spreadsheet / Word / text files
  let pdfs = 0;
  const sentImages = new Set<string>();
  for (const a of atts) {
    try {
      if (a.signature) continue;
      if (a.kind === "image" && supported.includes(a.type) && a.size < 3_500_000 && images < maxImages) {
        const key = `${a.type}|${a.size}`;
        if (sentImages.has(key)) continue; // same picture repeated in every reply
        sentImages.add(key);
        const { body } = await fetchArtifact(a.artifact_id, a.part);
        blocks.push({ type: "text", text: `Attachment "${a.name}" (from ${a.from ?? "?"}, ${a.comment_date}):` });
        blocks.push({ type: "image", source: { type: "base64", media_type: a.type as ImageType, data: body.toString("base64") } });
        images++;
      } else if (a.kind === "email") {
        // The email itself (subject, people, full body) — often where the real details are (invoice lists, IDs…).
        // Also covers emails forwarded as attachments inside another email (a.part set).
        if (emailBudget <= 0) { blocks.push({ type: "text", text: `Attached email "${a.name}" skipped — too many emails on this ticket.` }); continue; }
        const m = a.part == null ? await parseEmail(a.artifact_id) : await simpleParser((await fetchArtifact(a.artifact_id, a.part)).body);
        const body = (m.text || (typeof m.html === "string" ? htmlToText(m.html) : "") || "").trim();
        const to = [m.to, m.cc].flat().filter(Boolean).map((x) => (x as { text: string }).text).join(", ");
        const max = Math.min(30000, emailBudget);
        emailBudget -= Math.min(body.length, max);
        blocks.push({
          type: "text",
          text: `Attached email "${a.name}" (from ${a.from ?? "?"}, ${a.comment_date}):\n` +
            `Subject: ${m.subject ?? ""}\nFrom: ${m.from?.text ?? ""}\nTo/Cc: ${to}\nDate: ${m.date?.toISOString() ?? ""}\n\n` +
            (body.length > max ? body.slice(0, max) + "\n…[email truncated]" : body || "(empty body)"),
        });
      } else if (isPdf(a)) {
        // Claude reads PDFs natively — text and scanned pages (invoices, challans, POs). API limit: 32 MB / 100 pages.
        if (pdfs >= maxPdfs || a.size > 20_000_000) { blocks.push({ type: "text", text: `PDF "${a.name}" not read — ${pdfs >= maxPdfs ? "too many PDFs on this ticket" : "file too large"}.` }); continue; }
        const { body } = await fetchArtifact(a.artifact_id, a.part);
        blocks.push({ type: "text", text: `Attached PDF "${a.name}" (from ${a.from ?? "?"}, ${a.comment_date}):` });
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.toString("base64") }, title: a.name });
        pdfs++;
      } else if (a.kind === "file" && a.size < 25_000_000) {
        const { body } = await fetchArtifact(a.artifact_id, a.part);
        const text = await fileText(a, body);
        if (text == null) continue; // zip, video, … — only listed by name
        if (fileBudget <= 0) { blocks.push({ type: "text", text: `Attachment "${a.name}" not read — too many files on this ticket.` }); continue; }
        const max = Math.min(40000, fileBudget);
        fileBudget -= Math.min(text.length, max);
        blocks.push({
          type: "text",
          text: `Attached file "${a.name}" (from ${a.from ?? "?"}, ${a.comment_date}):\n` +
            (text.length > max ? text.slice(0, max) + `\n…[file truncated — ${text.length} characters in total]` : text.trim() || "(empty file)"),
        });
      }
    } catch {
      blocks.push({ type: "text", text: `Attachment "${a.name}" could not be downloaded.` });
    }
  }
  return blocks;
}
