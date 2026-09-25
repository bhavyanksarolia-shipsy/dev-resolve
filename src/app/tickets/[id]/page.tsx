import { Workspace } from "@/components/Workspace";

export default async function TicketPage(props: PageProps<"/tickets/[id]">) {
  const { id } = await props.params;
  return <Workspace ticketId={decodeURIComponent(id)} />;
}
