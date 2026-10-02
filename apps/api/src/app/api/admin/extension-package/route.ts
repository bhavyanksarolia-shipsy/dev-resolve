import { requireAdmin } from "@/lib/adminGuard";
import { EXTENSION_VERSION, extensionFiles } from "@/lib/extensionPackage";
import { publicOrigin } from "@/lib/google";
import { settings } from "@/lib/settings";
import { zip } from "@/lib/zip";

/** The Chrome Web Store upload package for this deployment (admin → Chrome extension → Download for the Web Store). */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const app = publicOrigin(req);
  const files = await extensionFiles({ app, server: settings.backendPublicUrl() || app });
  return new Response(new Uint8Array(zip(files)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="dev-resolve-extension-${EXTENSION_VERSION}.zip"`, "Cache-Control": "no-store" },
  });
}
