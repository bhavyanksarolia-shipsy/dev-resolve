import { sendChatMessage } from "@/lib/agent/run";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";

const MAX_FILES = 10, MAX_FILE = 20 * 1024 * 1024, MAX_TOTAL = 30 * 1024 * 1024;

/**
 * Reviewer message on an RCA → resumes the investigation's agent session (runs in the background; poll the investigation).
 * JSON { message } or multipart form data: message + files (images, PDFs, emails, sheets, Word, text…).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/investigations/[id]/chat">) {
  const { id } = await ctx.params;
  const by = await currentUser(req);
  let message = "";
  let uploads: File[] = [];
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "Couldn't read the upload — try fewer or smaller files" }, { status: 400 });
    message = String(form.get("message") ?? "");
    uploads = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  } else {
    message = String(((await req.json().catch(() => ({}))) as { message?: string }).message ?? "");
  }
  message = message.trim().slice(0, 8000);
  if (!message && !uploads.length) return Response.json({ error: "Type a message or attach a file" }, { status: 400 });
  if (uploads.length > MAX_FILES) return Response.json({ error: `Attach up to ${MAX_FILES} files at a time` }, { status: 400 });
  const big = uploads.find((f) => f.size > MAX_FILE);
  if (big) return Response.json({ error: `${big.name} is larger than 20 MB` }, { status: 400 });
  if (uploads.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) return Response.json({ error: "Files add up to more than 30 MB — send them in two messages" }, { status: 400 });

  const [inv] = await q<{ status: string; chat_running: boolean }>(`SELECT status, chat_running FROM investigations WHERE id=$1`, [id]);
  if (!inv) return Response.json({ error: "not found" }, { status: 404 });
  if (inv.status === "running" || inv.chat_running) return Response.json({ error: "The agent is still working on this ticket — wait for it to finish." }, { status: 409 });

  const files = [];
  for (const f of uploads) {
    const body = Buffer.from(await f.arrayBuffer());
    const name = (f.name || "file").replace(/[\\/\r\n"]/g, "_").slice(0, 200);
    const type = f.type || "application/octet-stream";
    const [row] = await q<{ id: number }>(`INSERT INTO chat_files (investigation_id, name, type, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [id, name, type, body.length, body, by]);
    files.push({ id: Number(row.id), name, type, size: body.length, body });
  }
  try {
    await sendChatMessage(Number(id), message, by, files);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
