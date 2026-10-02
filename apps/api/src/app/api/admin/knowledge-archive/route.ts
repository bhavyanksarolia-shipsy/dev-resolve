import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/adminGuard";
import { ROOT } from "@/lib/config";

/** Download the server's knowledge base as .tgz (backup, or to move it to another Dev Resolve). */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const dir = path.join(ROOT, "knowledge");
  if (!existsSync(dir)) return Response.json({ error: "No knowledge yet" }, { status: 404 });
  const data = execFileSync("tar", ["-czf", "-", "--exclude=_template", "--exclude=README.md", "--exclude=._*", "-C", dir, "."], { maxBuffer: 200 * 1024 * 1024 });
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="dev-resolve-knowledge-${new Date().toISOString().slice(0, 10)}.tgz"` },
  });
}
