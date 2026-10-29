import { LegalShell } from "@/components/legal-shell";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Content Licence — ${BRAND.name}`,
  description: `How copyright, artist ownership, moral rights and platform display licences work on ${BRAND.name}.`,
};

export default function LicencePage() {
  return (
    <LegalShell
      eyebrow="Copyright Act 1968 (Cth) · Artist Ownership"
      title="Content Licence"
      lead={`Artists retain full copyright in every work they upload to ${BRAND.name}. This licence sets out the limited, revocable permissions you grant us so we can host, transcode and display your published portfolio and event media.`}
      meta={[
        "Effective: 28 October 2026",
        "Default: All Rights Reserved to the Artist",
        "Jurisdiction: Australia",
      ]}
      sections={[
        {
          id: "ownership",
          title: "1. You keep your copyright",
          body: (
            <>
              <p>
                {BRAND.name} claims no ownership over your artwork, photography,
                sound recordings, moving image works, writing or event
                materials. Copyright in all member-uploaded works remains with
                the creator or rightsholder at all times.
              </p>
              <p>
                Visitors may view published works on {BRAND.name} for personal,
                non-commercial appreciation and discovery. Copying,
                redistributing, training machine-learning models on, or making
                commercial use of an artist&rsquo;s work without their express
                permission is prohibited.
              </p>
            </>
          ),
        },
        {
          id: "platform-licence",
          title: "2. Limited licence granted to Happenfolk",
          body: (
            <>
              <p>
                Solely so that we can operate the service, when you mark a
                profile, portfolio item or event as published you grant{" "}
                {BRAND.name} a worldwide, royalty-free,{" "}
                <strong>non-exclusive</strong> licence to:
              </p>
              <ul>
                <li>
                  Store your uploaded originals in private draft storage and
                  generate optimised display derivatives (such as WebP images,
                  thumbnails, MP3 audio streams and H.264 MP4 video previews) in{" "}
                  <code>public.media_assets</code>;
                </li>
                <li>
                  Display those derivatives on your public profile page (
                  <code>/artists/[handle]</code>), your work detail page (
                  <code>/items/[id]</code>), the home and discovery feeds, and
                  any event pages you host or collaborate on.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "termination",
          title: "3. Revocation when unpublished or deleted",
          body: (
            <>
              <p>
                You are in control of publication at all times. The display
                licence above is automatically <strong>terminated</strong> as
                soon as you unpublish the work or profile in your studio
                dashboard or delete the item from your account.
              </p>
              <p>
                Unpublishing a work through the studio removes its public
                display derivatives. Unpublishing a profile removes its portfolio
                from public listings and detail pages. Copies already downloaded
                or cached elsewhere cannot be recalled automatically.
              </p>
            </>
          ),
        },
        {
          id: "moral-rights",
          title: "4. Attribution, moral rights and takedowns",
          body: (
            <>
              <p>
                In accordance with Part IX of the{" "}
                <em>Copyright Act 1968 (Cth)</em>, {BRAND.name} attributes every
                published work to its creator&rsquo;s display name and handle
                and strips only technical camera/location EXIF metadata for
                privacy while preserving visual integrity.
              </p>
              <p>
                If you believe material on {BRAND.name} infringes your copyright
                or moral rights, please send a notice identifying the work and
                your contact details to the project team through the course
                submission channel. This demonstration does not provide a
                monitored public copyright inbox.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
