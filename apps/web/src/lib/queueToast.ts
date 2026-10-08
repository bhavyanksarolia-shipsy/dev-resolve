import { toast } from "@/components/Dialog";

interface Entry { id: number; mine: boolean; position?: number; waitMin?: number }
interface Queue { max: number; perPerson: number; running: Entry[]; waiting: Entry[] }
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/**
 * Right after starting an investigation / sending a chat message: if it has to wait in line, say so in a pop-up — and
 * why (your own per-person limit, or every slot busy). It joins the line a few seconds after starting (the ticket and
 * its files are read first), so this looks a few times and stops as soon as it's running or waiting.
 */
export function toastIfQueued(id: number, ticket: string, kind: "investigation" | "chat") {
  const look = async (left: number) => {
    const q: Queue | null = await fetch("/api/queue", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!q) return;
    if (q.running.some((r) => r.id === id)) return; // started straight away — nothing to say
    const me = q.waiting.find((w) => w.id === id);
    if (!me) { if (left > 0) setTimeout(() => void look(left - 1), 2500); return; }
    const mine = q.running.filter((r) => r.mine).length;
    const why = mine >= q.perPerson
      ? `you already have ${mine} running — the limit is ${q.perPerson} per person while others are waiting`
      : `all ${q.max} slots are busy`;
    const what = kind === "chat" ? `Your message on ${ticket}` : ticket;
    toast({ ok: true, text: `${what} is queued: ${why}. ${me.position === 1 ? "Next up" : `${ordinal(me.position!)} in line`}, about ${me.waitMin} min — it starts by itself and you'll be notified when it's done.` });
  };
  setTimeout(() => void look(4), 1500);
}
