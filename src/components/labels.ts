// Human-friendly labels for the investigation trail and knowledge proposals (no raw tool names / file paths).

const LOG_KIND: Record<string, string> = { app: "app logs", audit: "audit logs", link: "SAP / integration logs", api: "integration logs" };

function logKind(logType: unknown) {
  const lt = String(logType || "");
  const k = Object.keys(LOG_KIND).find((x) => lt.endsWith(`_${x}`));
  return k ? LOG_KIND[k] : "logs";
}

const clip = (v: unknown, n = 60) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
};

export function toolName(tool: string | null) {
  return (tool || "").split("__").pop() || "";
}

/** One readable line for a tool call. Deliberately never includes source-file paths. */
export function describeCall(tool: string | null, input: Record<string, unknown> | null): string {
  const i = input || {};
  switch (toolName(tool)) {
    case "search_logs": {
      const what = i.query || i.request_contains || i.response_contains || i.request_id || i.request_path || i.username;
      const scope = [i.warehouse && `DC ${i.warehouse}`, i.level && `${i.level}`, i.hours_back && `last ${Number(i.hours_back) >= 48 ? `${Math.round(Number(i.hours_back) / 24)} days` : `${i.hours_back}h`}`].filter(Boolean).join(" · ");
      return `Searched ${logKind(i.log_type)}${what ? ` for “${clip(what)}”` : ""}${scope ? ` (${scope})` : ""}`;
    }
    case "list_log_types": return "Checked which log sources are available";
    case "metabase_query": return "Queried the database";
    case "metabase_tables": return "Looked up database tables";
    case "code_search": return `Searched the code for “${clip(i.pattern, 50)}”`;
    case "code_read": return "Read source code";
    case "similar_cases": return "Looked up similar past tickets";
    case "propose_knowledge": return `Proposed a learning for the ${fileLabel(String(i.file || "")).toLowerCase()}`;
    case "submit_rca": return "Submitted the RCA draft";
    default: return "Ran a check";
  }
}

export const STEP_ICON: Record<string, string> = {
  search_logs: "🔎", list_log_types: "🔎", metabase_query: "🗄️", metabase_tables: "🗄️", code_search: "💻", code_read: "💻",
  similar_cases: "📚", propose_knowledge: "💡", submit_rca: "📝",
};

/** Whether a tool's raw output may be shown (code tools return file paths — only a summary is shown for those). */
export function resultSummary(tool: string | null, output: string | null): { summary: string; showRaw: boolean } {
  const out = output || "";
  const name = toolName(tool);
  if (name === "code_search") {
    const n = out.trim() && out.trim() !== "No matches." ? out.trim().split("\n").filter((l) => /:\d+:/.test(l)).length : 0;
    return { summary: n ? `${n} match${n > 1 ? "es" : ""} in the code` : "No matches in the code", showRaw: false };
  }
  if (name === "code_read") return { summary: `Read ${out.split("\n").length} lines`, showRaw: false };
  if (name === "propose_knowledge" || name === "submit_rca" || name === "list_log_types") return { summary: "", showRaw: false };
  if (name === "similar_cases") {
    try { const rows = JSON.parse(out); if (Array.isArray(rows)) return { summary: `${rows.length} similar past ticket${rows.length === 1 ? "" : "s"}: ${rows.map((r: { ticket_display?: string }) => r.ticket_display).filter(Boolean).join(", ")}`, showRaw: false }; } catch { /* plain text */ }
    return { summary: /No similar/.test(out) ? "No similar past tickets yet" : "Checked past tickets", showRaw: false };
  }
  const m = out.match(/(\d+) total matches/);
  if (m) return { summary: `${m[1]} matching log entries`, showRaw: true };
  if (/No matching log entries/.test(out)) return { summary: "No matching log entries", showRaw: true };
  if (name === "metabase_query") {
    try { const rows = JSON.parse(out); if (Array.isArray(rows)) return { summary: `${rows.length} row${rows.length === 1 ? "" : "s"}`, showRaw: true }; } catch { /* not JSON */ }
    if (/error/i.test(out)) return { summary: "Query error", showRaw: true };
  }
  return { summary: "Result", showRaw: true };
}

/** Knowledge-base file → plain name. */
export function fileLabel(file: string) {
  if (file.startsWith("queries/")) return "Saved query";
  return ({ "playbook.md": "Playbook", "glossary.md": "Glossary", "log-patterns.md": "Log patterns", "schema.md": "Schema notes", "wms-flows.md": "WMS-wide notes" } as Record<string, string>)[file] ?? "Knowledge base";
}

export function scopeLabel(slug: string) {
  return slug === "_shared" ? "All accounts" : slug.split("-").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/** Hide file paths in text shown in the trail / proposals: code files → "source code", saved queries → "the saved query". */
export function hidePaths(text: string | null | undefined): string {
  return (text || "")
    .replace(/`?(?:queries\/)?[\w.-]+\.sql`?/g, "the saved query")
    .replace(/`?(?:[\w.-]+\/)*[\w.-]+\.(?:py|ts|tsx|js|jsx|java|go|rb)(?::\d+(?:-\d+)?|\s*~?L\d+(?:-\d+)?)?`?/g, "source code");
}
