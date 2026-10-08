import { currentUser } from "@/lib/auth";
import { chainFor, mainState, usable } from "@/lib/claudeRoute";
import { gatewayCarrier } from "@/lib/connector";

/**
 * What YOUR investigations reach Claude with right now — for the short "connected to Bifrost" / "using your own Claude
 * token" pop-ups. Cheap: no network calls, just the state the relay and the connection check keep.
 */
export async function GET(req: Request) {
  const me = await currentUser(req);
  const chain = chainFor(me);
  const using = chain.find((u) => usable(u, me));
  const st = mainState();
  const main = chain[0];
  return Response.json({
    main: main?.label ?? null,
    mainDown: st.down,
    using: !using ? "none" : using.id === "main" ? "main" : using.id.startsWith("personal:") ? "personal" : "server",
    usingLabel: !using ? null : using.id.startsWith("personal:") ? "your own Claude token" : using.label,
    through: main?.viaExtension && using?.id === "main" ? gatewayCarrier(me, { vpnChecked: true }) : null,
    restoredAt: !st.down && st.restoredAt ? new Date(st.restoredAt).toISOString() : null,
  });
}
