import { Workspace } from "@/components/Workspace";

export default async function TicketPage(props: PageProps<"/tickets/[id]">) {
  const { id } = await props.params;
  // key: a new ticket replays the slide-up even when navigating ticket → ticket.
  return <div key={id} className="ticket-sheet"><Workspace ticketId={decodeURIComponent(id)} /></div>;
}
