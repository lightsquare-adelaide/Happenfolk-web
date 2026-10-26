import { PageReveal } from "@/components/page-reveal";

/**
 * Per-navigation wrapper. Unlike layout.tsx this remounts on every route
 * change, which is exactly where a subtle entry transition belongs. See
 * components/page-reveal.tsx for why the first document paint is excluded.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageReveal>{children}</PageReveal>;
}
