import { redirect } from "next/navigation";

/** Old address — everything moved to Admin. */
export default function SettingsPage() {
  redirect("/admin?tab=files");
}
