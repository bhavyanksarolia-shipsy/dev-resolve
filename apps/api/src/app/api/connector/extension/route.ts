import { sessionUser } from "@/lib/auth";
import { extensionFiles } from "@/lib/extensionPackage";
import { publicOrigin } from "@/lib/google";
import { settings } from "@/lib/settings";
import { zip } from "@/lib/zip";

/** The Chrome extension, pre-configured for this deployment (for "Load unpacked" until it's in the Web Store). */
export async function GET(req: Request) {
  if (!(await sessionUser(req))) return Response.json({ error: "Sign in required" }, { status: 401 });
  const app = publicOrigin(req);
  const files = await extensionFiles({ app, server: settings.backendPublicUrl() || app });
  return new Response(new Uint8Array(zip(files)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="dev-resolve-connector-extension.zip"', "Cache-Control": "no-store" },
  });
}
