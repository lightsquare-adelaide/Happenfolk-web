import { BRAND } from "@/lib/brand";
import type { Metadata } from "next";
import { Archivo, Geist_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Logo } from "@/components/logo";
import "../lib/env";
import "./globals.css";
import "./hf.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: BRAND.name,
  description: "Showcase and collaboration platform for South Australian independent artists.",
  icons: { icon: "/happenfolk-mark.svg" },
};

function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div>
          <Link className="logo" href="/" aria-label={`${BRAND.name} home`}>
            <Logo />
          </Link>
          <p>Portfolios and events from independent artists in South Australia.</p>
        </div>
        <div>
          <h2>Discover</h2>
          <ul>
            <li><Link href="/">Newsfeed</Link></li>
            <li><Link href="/events">Events</Link></li>
            <li><Link href="/artists">Artists</Link></li>
          </ul>
        </div>
        <div>
          <h2>Members</h2>
          <ul>
            <li><Link href="/register">Create account</Link></li>
            <li><Link href="/login">Sign in</Link></li>
            <li><Link href="/dashboard">Dashboard</Link></li>
          </ul>
        </div>
        <div>
          <h2>Preview</h2>
          <ul>
            <li><span className="t14 muted">Build for client feedback. Sample data only.</span></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${archivo.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SiteHeader />
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
