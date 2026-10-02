import { q } from "@/lib/db";

/** A file someone attached in the RCA chat (signed-in users only — see proxy.ts). Images/PDFs open inline. */
export async function GET(_req: Request, ctx: RouteContext<"/api/chat-files/[id]">) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return new Response("bad id", { status: 400 });
  const [f] = await q<{ name: string; type: string; data: Buffer }>(`SELECT name, type, data FROM chat_files WHERE id=$1`, [id]);
  if (!f) return new Response("not found", { status: 404 });
  const inline = /^image\/(png|jpeg|gif|webp)$/.test(f.type) || f.type === "application/pdf";
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": inline ? f.type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
