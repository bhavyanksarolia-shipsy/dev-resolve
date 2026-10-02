/** Runs once when the server starts: print the ports/URLs in effect (no secrets) so a wrong one shows in the logs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { settingsSummary } = await import("./lib/settings");
  console.log("[settings]", JSON.stringify(settingsSummary()));
}
