import { sendChatMessage } from "@/lib/agent/run";

/** Reviewer message on an RCA → resumes the investigation's agent session (runs in the background; poll the investigation). */
export async function POST(req: Request, ctx: RouteContext<"/api/investigations/[id]/chat">) {
  const { id } = await ctx.params;
  const { message } = (await req.json()) as { message?: string };
  if (!message?.trim()) return Response.json({ error: "message is required" }, { status: 400 });
  try {
    await sendChatMessage(Number(id), message.trim().slice(0, 8000));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
