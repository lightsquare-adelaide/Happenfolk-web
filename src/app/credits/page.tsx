import { LegalShell } from "@/components/legal-shell";
import { CURATED_ARTWORK } from "@/lib/artwork";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Credits & Attribution — ${BRAND.name}`,
  description: `Public-domain artwork provenance, typography and open-source software credits for ${BRAND.name}.`,
};

export default function CreditsPage() {
  return (
    <LegalShell
      eyebrow="Provenance · Public Domain & Open Source"
      title="Credits & Attribution"
      lead={`Credits for the curated artwork, typography and main software used to build ${BRAND.name} is recorded below with its creator, institution and licence.`}
      meta={[
        `Curated works: ${CURATED_ARTWORK.length} (CC0 1.0 Public Domain)`,
        "Manifest: docs/design/artwork-sources.json",
      ]}
      sections={[
        {
          id: "curated-artwork",
          title: "Curated public-domain artwork",
          body: (
            <>
              <p>
                Editorial shell placements (such as authentication asides and
                empty-database fallbacks) draw from preserved public-domain
                works in the Art Institute of Chicago collection. These works
                are credited as historical museum pieces and are never presented
                as portfolio items of a {BRAND.name} member:
              </p>
              <ul className="!list-none space-y-4 !pl-0">
                {CURATED_ARTWORK.map((art) => (
                  <li
                    key={art.file}
                    className="border border-line bg-surface p-4 text-foreground"
                  >
                    <p className="font-medium">
                      {art.title}{" "}
                      <span className="font-normal text-muted">
                        ({art.year}) — {art.creator}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted">{art.alt}</p>
                    <p className="mt-2 font-mono text-xs text-muted">
                      Source: {art.source} · Licence: {art.license} · File:{" "}
                      <code>/artwork/{art.file}</code> ·{" "}
                      <a
                        href={art.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground underline underline-offset-4"
                      >
                        Museum record ↗
                      </a>
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ),
        },
        {
          id: "seed-media",
          title: "Seeded demonstration media",
          body: (
            <>
              <p>
                Demonstration profiles and events are sample data. Public-domain
                reference artwork is labelled separately from member portfolios.
                The preserved artwork source record is in{" "}
                <code>docs/design/artwork-sources.json</code>; this release does
                not claim fresh external licence verification.
              </p>
            </>
          ),
        },
        {
          id: "typography-and-software",
          title: "Typography and open-source software",
          body: (
            <>
              <p>
                {BRAND.name} is built with open-source software and open-licence
                typefaces:
              </p>
              <ul>
                <li>
                  <strong>Typography</strong> — Archivo (Omnibus-Type, SIL
                  Open Font License) and Instrument Sans (Instrument, SIL OFL).
                  Identifiers use the system monospace font.
                </li>
                <li>
                  <strong>Application &amp; database stack</strong> — Next.js,
                  React, TypeScript, Tailwind CSS, Supabase (PostgreSQL, GoTrue
                  Auth, Storage), Sharp and FFmpeg for media transcoding and
                  EXIF stripping, and Vitest for verification suites.
                </li>
              </ul>
            </>
          ),
        },
      ]}
    />
  );
}
