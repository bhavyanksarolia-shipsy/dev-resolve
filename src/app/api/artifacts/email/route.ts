import { parseEmail } from "@/lib/attachments";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Renders an attached email.eml as the customer sent it. Served sandboxed: no scripts, no forms, no navigation. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id?.startsWith("don:core:")) return new Response("bad id", { status: 400 });
  try {
    const m = await parseEmail(id);
    let html = typeof m.html === "string" ? m.html : `<pre>${esc(m.text || "")}</pre>`;
    // Inline images (cid:...) → served parts
    m.attachments.forEach((p, i) => {
      if (p.cid) html = html.split(`cid:${p.cid}`).join(`/api/artifacts/file?id=${encodeURIComponent(id)}&part=${i}`);
    });
    const from = m.from?.text ?? "";
    const to = Array.isArray(m.to) ? m.to.map((t) => t.text).join(", ") : m.to?.text ?? "";
    const files = m.attachments.map((p, i) =>
      `<a href="/api/artifacts/file?id=${encodeURIComponent(id)}&part=${i}">${esc(p.filename || `part-${i}`)}</a> (${Math.round(p.size / 1024)} KB)`).join(" · ");
    const page = `<!doctype html><meta charset="utf-8"><title>${esc(m.subject || "Email")}</title>
<div style="font:13px system-ui;padding:10px 14px;border-bottom:1px solid #ccc;background:#f6f6f4">
<b>${esc(m.subject || "")}</b><br>From: ${esc(from)}<br>To: ${esc(to)}<br>Date: ${esc(m.date?.toISOString() ?? "")}
${files ? `<br>Attachments: ${files}` : ""}</div><div style="padding:14px">${html}</div>`;
    return new Response(page, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Customer-supplied HTML: sandboxed (no scripts/forms), images only from our own attachment proxy or data URIs.
        "Content-Security-Policy": "sandbox allow-popups; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return new Response(`Could not read email: ${(e as Error).message}`, { status: 502 });
  }
}
