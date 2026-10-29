import { LegalShell } from "@/components/legal-shell";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Terms of Use — ${BRAND.name}`,
  description: `Terms governing use of the ${BRAND.name} creative community platform, portfolios and event registrations.`,
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Platform Agreement · South Australia"
      title="Terms of Use"
      lead={`These terms govern your access to and use of ${BRAND.name}, including publishing artist profiles and portfolio works, listing in the collaboration directory, and hosting or registering for community events.`}
      meta={[
        "Effective: 28 October 2026",
        "Operator: Happenfolk Project Team",
        "Governing Law: South Australia, Australia",
      ]}
      sections={[
        {
          id: "accounts",
          title: "1. Accounts and eligibility",
          body: (
            <>
              <p>
                To publish a profile, upload portfolio media, like works or host
                events on {BRAND.name}, you must register an account with a
                valid email address and choose a unique handle (3–30 lowercase
                letters, digits or underscores).
              </p>
              <p>
                You are responsible for safeguarding your sign-in credentials
                and for all activity carried out under your account. You may
                register as an individual practitioner or on behalf of a
                cultural organisation you are authorised to represent.
              </p>
            </>
          ),
        },
        {
          id: "content-responsibility",
          title: "2. Content responsibility and acceptable use",
          body: (
            <>
              <p>
                <strong>Content responsibility</strong> rests with the member
                who uploads or publishes each profile, portfolio work or event
                listing. By publishing material on {BRAND.name}, you warrant
                that:
              </p>
              <ul>
                <li>
                  You hold the necessary copyright, moral-rights consents and
                  performer releases for every image, audio recording, video clip
                  and text description you upload.
                </li>
                <li>
                  Your material does not infringe third-party intellectual
                  property, breach confidence, defame any person, or violate
                  Australian federal or state law.
                </li>
                <li>
                  You will not attempt to bypass Row-Level Security policies,
                  scrape member contact emails for unsolicited bulk mail, or
                  upload malicious files.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "events-and-bookings",
          title: "3. Events, registrations and simulated checkout",
          body: (
            <>
              <p>
                Organisations and practitioners may publish free or ticketed
                events with a stated capacity and schedule. Event hosts are
                responsible for the accuracy of venue details, accessibility
                notes and programme descriptions.
              </p>
              <p>
                Paid bookings in this release use a simulated order ledger (
                <code>public.orders</code>) to demonstrate seat allocation and
                capacity enforcement; no real financial charge is processed on
                this environment.
              </p>
            </>
          ),
        },
        {
          id: "moderation-and-liability",
          title: "4. Moderation, staff hiding and liability",
          body: (
            <>
              <p>
                Designated {BRAND.name} staff listed in{" "}
                <code>public.admin_staff</code> may hide a profile, portfolio
                item or event (<code>is_hidden = true</code>) using staff moderation controls if it breaches these terms, contains
                inaccurate venue safety information, or is the subject of a
                takedown notice. Hidden items are removed immediately from
                public feeds, search results and discovery views while remaining
                accessible to the owner in their studio.
              </p>
              <p>
                To the maximum extent permitted by the Australian Consumer Law,{" "}
                {BRAND.name} is provided on an &ldquo;as is&rdquo; basis without
                warranties of uninterrupted availability. These terms are
                governed by the laws of South Australia.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
