/** Runs once when the server starts: print the ports/URLs in effect (no secrets) so a wrong one shows in the logs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { settingsSummary } = await import("./lib/settings");
  console.log("[settings]", JSON.stringify(settingsSummary()));
  (await import("./lib/codeSync")).startCodeSync();
  // Agent runs live in this process: after a restart, "running" rows are orphans. Free them (they'd also hold the
  // one-running-investigation-per-ticket lock) so the ticket shows Try again.
  try {
    const { q } = await import("./lib/db");
    const freed = await q(`UPDATE investigations SET status='failed', error='Interrupted — the server restarted. Try again.', finished_at=now()
                            WHERE status='running' RETURNING id`);
    await q(`UPDATE investigations SET chat_running=false WHERE chat_running`);
    if (freed.length) console.log(`[start] marked ${freed.length} interrupted investigation(s) as failed`);
  } catch (e) {
    console.error("[start] couldn't clear interrupted investigations:", (e as Error).message);
  }
}
