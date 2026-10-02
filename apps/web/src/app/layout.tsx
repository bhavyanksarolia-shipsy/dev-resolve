import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dev Resolve",
  description: "Evidence-based RCAs for DevRev tickets — logs, DB and code, per account.",
};

/** UI only: who's signed in, and everything else, comes from the backend through /api (see AppHeader). */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <AppHeader />
        <main className="w-full px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
