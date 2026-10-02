import { fetchArtifact } from "@/lib/attachments";
import { locateArtifact } from "@/lib/devrev";

/** Streams a ticket attachment (or a file inside an attached email) through Dev Resolve — DevRev's signed URLs expire. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  const part = sp.get("part");
  if (!id?.startsWith("don:core:")) return new Response("bad id", { status: 400 });
  try {
    if (part == null) return Response.redirect(await locateArtifact(id), 302);
    const f = await fetchArtifact(id, Number(part));
    const inline = f.type.startsWith("image/") || f.type === "application/pdf";
    return new Response(new Uint8Array(f.body), {
      headers: {
        "Content-Type": f.type,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=1800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return new Response(`Could not fetch attachment: ${(e as Error).message}`, { status: 502 });
  }
}
