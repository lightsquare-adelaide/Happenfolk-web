import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Z } from "@/components/nav-items";
import { BRAND } from "@/lib/brand";
import { themeBootstrapScript } from "@/lib/theme";
import "../lib/env";
import "./globals.css";

/*
 * Two self-hosted variable faces, both OFL, both in public/fonts with their
 * licence files and sources. No third voice, no build-time or runtime fetch
 * from a font CDN.
 *
 * Archivo is registered with its real width range (62% to 125%) so the brand's
 * condensed display setting is an actual wdth axis value. The condensed look
 * must never be faked with transform: scaleX.
 */
const archivo = localFont({
  src: "../../public/fonts/archivo-latin.woff2",
  variable: "--hf-archivo",
  display: "swap",
  weight: "400 800",
  style: "normal",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
  fallback: ["Arial Narrow", "Helvetica Neue", "sans-serif"],
  adjustFontFallback: false,
});

const instrumentSans = localFont({
  src: "../../public/fonts/instrumentsans-latin.woff2",
  variable: "--hf-instrument",
  display: "swap",
  weight: "400 700",
  style: "normal",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: BRAND.name,
  description:
    "Showcase and collaboration platform for South Australian independent artists: public profiles, portfolios and events.",
  applicationName: BRAND.name,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

/**
 * Root layout: fonts, pre-paint theme resolution, skip link, sticky header,
 * page content and footer.
 *
 * suppressHydrationWarning on <html> is required and scoped to this element
 * only: the inline bootstrap script below sets data-theme before the first
 * paint, so the server HTML and the hydrated DOM differ by that one attribute.
 * Everything else still hydrates strictly.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${instrumentSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col bg-background text-foreground">
        {/* Runs before the first paint: applies the stored theme, else the
            system preference, so there is no flash of the wrong scheme. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />

        {/* A scroll reveal must never hide content from a visitor without
            JavaScript: the pending state is opt-in, so undo it here. */}
        <noscript>
          <style>{".reveal-pending{opacity:1 !important;transform:none !important}"}</style>
        </noscript>

        <a
          href="#main-content"
          className={`sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 ${Z.skipLink} focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand`}
        >
          Skip to content
        </a>

        <SiteHeader />

        {/* Skip target. tabindex -1 lets the skip link move focus here; the
            outline is suppressed on the container itself so the whole page is
            not ringed, while the link keeps its own visible focus state. */}
        <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          {children}
        </div>

        <SiteFooter />
      </body>
    </html>
  );
}
