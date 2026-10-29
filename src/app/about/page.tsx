import Link from "next/link";
import { LegalShell } from "@/components/legal-shell";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `About — ${BRAND.name}`,
  description:
    "How Happenfolk supports independent artists, studios and cultural organisations with portfolios, community events and open collaboration.",
};

export default function AboutPage() {
  return (
    <LegalShell
      eyebrow="Platform Overview · Adelaide & Australia"
      title={`About ${BRAND.name}`}
      lead={`${BRAND.name} is an independent creative community platform where practitioners and cultural organisations publish work, host workshops and exhibitions, and find collaborators across seven disciplines.`}
      meta={[
        "Version: 2026.10",
        "Hosting: Supabase & Vercel",
        "Jurisdiction: South Australia, Australia",
      ]}
      sections={[
        {
          id: "purpose",
          title: "Why Happenfolk exists",
          body: (
            <>
              <p>
                Independent artists and small cultural organisations often have
                to split their public presence across three disconnected tools:
                a portfolio site, a ticketing page for workshops or openings,
                and informal social channels for finding collaborators.
              </p>
              <p>
                <strong>{BRAND.name}</strong> brings those three surfaces into a
                single, calm editorial directory. Every member controls whether
                their profile and individual works are draft or public, can host
                or co-host events with transparent seat counts, and can opt into
                the{" "}
                <Link
                  href="/collaborate"
                  className="text-foreground underline underline-offset-4"
                >
                  collaboration directory
                </Link>{" "}
                when looking for fellow practitioners.
              </p>
            </>
          ),
        },
        {
          id: "disciplines",
          title: "Seven creative disciplines",
          body: (
            <>
              <p>
                Profiles, portfolio works and events share a single seven-category
                taxonomy so visitors can move between an exhibition, the artists
                behind it, and related studio work:
              </p>
              <ul>
                <li><strong>Music</strong> — composition, performance and sound.</li>
                <li><strong>Photography</strong> — photographic practice and image making.</li>
                <li><strong>Visual Arts</strong> — painting, sculpture and installation.</li>
                <li><strong>Performance</strong> — theatre, dance and live work.</li>
                <li><strong>Design</strong> — objects, graphics and creative design.</li>
                <li><strong>Film</strong> — cinema, video and moving image.</li>
                <li><strong>Food</strong> — culinary practice and community food events.</li>
              </ul>
            </>
          ),
        },
        {
          id: "discovery",
          title: "How discovery and recommendations work",
          body: (
            <>
              <p>
                The{" "}
                <Link
                  href="/discover"
                  className="text-foreground underline underline-offset-4"
                >
                  Discover
                </Link>{" "}
                page ranks trending events and artists using a 48-hour
                exponential decay over the last seven days of recorded views (
                <code>exp(-ln(2)/2 * age_days)</code>). Recent interest surfaces
                quickly without letting older popular listings dominate
                indefinitely.
              </p>
              <p>
                When you sign in, {BRAND.name} computes category affinity from
                your own likes (weight 3) and your own signed-in page views
                (weight 1) via a <code>SECURITY INVOKER</code> view. Your
                affinity signals are never visible to other members.
              </p>
            </>
          ),
        },
        {
          id: "architecture",
          title: "Hosting, privacy and data stewardship",
          body: (
            <>
              <p>
                {BRAND.name} runs on Next.js (deployed to Vercel) backed by
                Supabase PostgreSQL, Auth and Storage. Row-Level Security (RLS)
                is enabled on every application table in the{" "}
                <code>public</code> schema so access rules are enforced by the
                database regardless of how a request arrives.
              </p>
              <p>
                Uploaded images are stripped of EXIF metadata (including GPS
                coordinates) before being written to public storage, and raw
                page-view logs are rolled up into anonymous monthly aggregates
                after 90 days. Read our{" "}
                <Link
                  href="/privacy"
                  className="text-foreground underline underline-offset-4"
                >
                  Privacy Policy
                </Link>
                ,{" "}
                <Link
                  href="/terms"
                  className="text-foreground underline underline-offset-4"
                >
                  Terms of Use
                </Link>
                ,{" "}
                <Link
                  href="/licence"
                  className="text-foreground underline underline-offset-4"
                >
                  Content Licence
                </Link>{" "}
                and{" "}
                <Link
                  href="/credits"
                  className="text-foreground underline underline-offset-4"
                >
                  Credits
                </Link>{" "}
                for full details.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
