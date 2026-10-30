import { LegalShell } from "@/components/legal-shell";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Privacy Policy — ${BRAND.name}`,
  description:
    "How Happenfolk collects, uses, retains and protects personal information in accordance with the Australian Privacy Principles.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Privacy Act 1988 (Cth) · Australian Privacy Principles"
      title="Privacy Policy"
      lead={`This notice explains what personal information ${BRAND.name} collects, how it is stored on Supabase and Vercel infrastructure, how long it is kept, and how you can access, correct or delete it.`}
      meta={[
        "Effective: 28 October 2026",
        "Controller: Happenfolk Project Team",
        "Framework: Australian Privacy Principles (APPs 1–13)",
      ]}
      sections={[
        {
          id: "collection",
          title: "Information we collect (APPs 1–5)",
          body: (
            <>
              <p>
                We collect only the information needed to run artist portfolios,
                collaboration listings and event registrations on {BRAND.name}:
              </p>
              <ul>
                <li>
                  <strong>Account credentials</strong> — your email address and
                  password hash managed by Supabase Auth (<code>auth.users</code>
                  ), plus session tokens stored in HTTP cookies (
                  <code>sb-*-auth-token</code>).
                </li>
                <li>
                  <strong>Profile details</strong> — your handle, display name,
                  account type (individual or organisation), creative category,
                  biography, avatar image, optional public{" "}
                  <code>contact_email</code>, and whether you have opted into{" "}
                  <code>open_to_collaborate</code>.
                </li>
                <li>
                  <strong>Portfolio works &amp; media</strong> — titles,
                  descriptions, years, tags and media files you upload. Image
                  uploads are re-encoded with Sharp so embedded EXIF camera and
                  GPS location tags are stripped before public publication.
                </li>
                <li>
                  <strong>Event bookings &amp; orders</strong> — member and event
                  identifiers, registration status and simulated checkout totals in{" "}
                  <code>event_registrations</code> and <code>orders</code>. No live
                  payment card numbers are collected or stored.
                </li>
                <li>
                  <strong>Engagement signals</strong> — likes in{" "}
                  <code>interactions</code> and page views in{" "}
                  <code>page_views</code>. When you are signed in,{" "}
                  <code>record_member_view</code> attaches your{" "}
                  <code>viewer_id</code> to the view row so we can{" "}
                  <strong>record that it was you browsing</strong> and weight
                  your personal category recommendations. Anonymous visits use a deduplication hash and
                  record <code>viewer_id = NULL</code>; we do not store IP
                  addresses or third-party advertising identifiers in{" "}
                  <code>page_views</code>.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "use-and-disclosure",
          title: "How we use and disclose data (APPs 6–8)",
          body: (
            <>
              <p>
                Your information is used strictly to render published profiles,
                portfolios, collaboration cards and events, to compute trending
                and personalised discovery feeds, and to let event hosts manage
                their guest lists.
              </p>
              <ul>
                <li>
                  <strong>Contact email consent</strong> — account sign-in email
                  is never copied into your public profile. Saving an optional
                  contact email explicitly opts in to publishing that address on
                  your published profile. Clear it to withdraw that permission.
                </li>
                <li>
                  <strong>Public vs draft visibility</strong> — profiles and
                  portfolio items remain private until you set{" "}
                  <code>published = true</code>. Draft media lives in a private{" "}
                  <code>drafts</code> bucket accessible only to its owner.
                </li>
                <li>
                  <strong>Infrastructure providers</strong> — application pages
                  are served via Vercel and database/storage services are hosted
                  on Supabase. We do not sell, rent or trade personal
                  information to data brokers or advertising networks.
                </li>
                <li>
                  <strong>Sample &amp; demonstration data</strong> — seeded
                  profiles and events on demonstration deployments use synthetic{" "}
                  <code>@happenfolk.test</code> / <code>@lightsquare.test</code>{" "}
                  addresses and public-domain artwork.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "retention",
          title: "Data retention and monthly aggregation (APP 11)",
          body: (
            <>
              <p>
                Under Australian Privacy Principle 11.2, we take reasonable
                steps to destroy or de-identify personal information once it is
                no longer needed for its primary purpose:
              </p>
              <ul>
                <li>
                  <strong>Raw page views (90-day window)</strong> — individual
                  rows in <code>public.page_views</code> (including any linked{" "}
                  <code>viewer_id</code>) are retained for <strong>90 days</strong>{" "}
                  to power 7-day trending scores and recent affinity signals.
                </li>
                <li>
                  <strong>Monthly de-identified rollup</strong> — the scheduled
                  retention procedure{" "}
                  <code>public.run_page_view_retention</code> aggregates rows
                  older than the 90-day cutoff into{" "}
                  <code>public.page_views_monthly</code> (keyed only by{" "}
                  <code>view_month</code>, <code>subject_type</code>,{" "}
                  <code>subject_id</code> and <code>view_count</code>, with no{" "}
                  <code>viewer_id</code> or visitor hash) and then deletes the raw rows via{" "}
                  <code>public.purge_page_views_before</code>.
                </li>
                <li>
                  <strong>Account deletion cascade</strong> — deleting your
                  account removes your <code>profiles</code> row and cascades
                  through your portfolio items, likes and collaboration listing;
                  any remaining <code>page_views.viewer_id</code> references are
                  set to <code>NULL</code> (<code>ON DELETE SET NULL</code>).
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "rights",
          title: "Access, correction and erasure (APPs 12–13)",
          body: (
            <>
              <p>
                You can inspect and update your profile, contact email,
                collaboration status, portfolio items and event registrations at
                any time from your studio dashboard. You can unpublish your
                profile or any individual work immediately with a single toggle.
              </p>
              <p>
                For full account erasure or privacy enquiries under APPs 12 and
                13, contact the {BRAND.name} project team through the course
                submission channel. This is a course demonstration; it does not
                provide a monitored public privacy inbox.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
