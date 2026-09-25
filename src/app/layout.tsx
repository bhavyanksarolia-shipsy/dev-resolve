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
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">Dev Resolve</Link>
            <nav className="flex gap-4 text-sm text-muted">
              <Link href="/">Tickets</Link>
              <Link href="/knowledge">Knowledge</Link>
            </nav>
            {user && <InvestigationNotifier />}
            {user && <SignOut user={user} />}
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
