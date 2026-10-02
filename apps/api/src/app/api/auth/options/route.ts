import { googleEnabled, passwordLoginEnabled } from "@/lib/google";

/** Which sign-in methods the login page should offer. */
export async function GET() {
  return Response.json({ google: googleEnabled(), password: passwordLoginEnabled() });
}
