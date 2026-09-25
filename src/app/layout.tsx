import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { InvestigationNotifier } from "@/components/InvestigationNotifier";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { SignOut } from "@/components/SignOut";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dev Resolve",
  description: "Evidence-based RCAs for DevRev tickets — logs, DB and code, per account.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <header className="sticky top-0 z-30 border-b border-line bg-panel/85 backdrop-blur">
          <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm text-white">DR</span>
              Dev Resolve
            </Link>
            <nav className="flex gap-1 text-sm">
              <Link href="/" className="rounded-md px-2.5 py-1 text-muted hover:bg-accent-soft hover:text-accent-strong">Tickets</Link>
              <Link href="/knowledge" className="rounded-md px-2.5 py-1 text-muted hover:bg-accent-soft hover:text-accent-strong">Knowledge</Link>
            </nav>
            {user && (
              <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
                <InvestigationNotifier />
                <SignOut user={user} />
              </div>
            )}
          </div>
        </header>
        <main className="w-full px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
