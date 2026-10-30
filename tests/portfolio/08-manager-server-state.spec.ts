import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pilot regressions (30 Oct pilot, W1):
 *
 * 1. The manager must render the SERVER-provided state directly: media
 *    counts, draft/published status and per-asset caption inputs come
 *    from props, so a successful upload/publish/caption action followed
 *    by router.refresh() repaints the card without a manual reload. A
 *    useState(initial) copy would freeze the card at its first render —
 *    exactly what the pilot saw ("MEDIA (0)" / "DRAFT" until refresh).
 *
 * 2. The private-profile guidance: the profile and each work have
 *    separate publish switches. When the profile is private, the
 *    manager must say so (pilot finding 3) and link to the profile
 *    editor, both page-level and next to the work Publish button.
 *
 * 3. The remount stamp in load-managed-portfolio must change when the
 *    media SET or ORDER changes (uploads, reorders) but NOT when only a
 *    signed-URL token churns — otherwise uploads would not remount the
 *    card onto fresh server state (finding 1) or every token refresh
 *    would wipe in-progress caption edits.
 *
 * The client component is rendered outside Next, so the router and Link
 * are stubbed deterministically (no new dependencies).
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

import { PortfolioManager } from "../../src/app/dashboard/portfolio/portfolio-manager";
import {
  loadManagedPortfolio,
  type ManagedWork,
} from "../../src/app/dashboard/portfolio/load-managed-portfolio";

function work(overrides: Partial<ManagedWork> & Pick<ManagedWork, "id" | "title">): ManagedWork {
  return {
    description: "",
    year: null,
    tags: [],
    published: false,
    stamp: "stamp",
    assets: [],
    ...overrides,
  };
}

function render(works: ManagedWork[], profilePublished: boolean, handle: string | null = "someone") {
  return renderToStaticMarkup(
    createElement(PortfolioManager, {
      initial: works,
      heading: "Portfolio",
      intro: "Intro text.",
      handle,
      profilePublished,
    }),
  );
}

describe("portfolio manager renders the server state", () => {
  const empty = work({ id: "w-empty", title: "Empty draft" });
  const twoAssets = work({
    id: "w-two", title: "Two media", published: true, stamp: "s2",
    assets: [
      { id: "a1", altText: "First", contentType: "image/jpeg", width: 10, height: 10, position: 0, previewUrl: "http://x/1" },
      { id: "a2", altText: "", contentType: "image/jpeg", width: 10, height: 10, position: 1, previewUrl: "http://x/2" },
    ],
  });

  it("shows each card's live media count, status and caption inputs from props", () => {
    const html = render([empty, twoAssets], true);
    // Media counts come straight from the server payload (finding 1).
    expect(html).toContain("Media (0)");
    expect(html).toContain("Media (2)");
    // Status comes straight from the server payload (finding 2).
    expect(html).toContain(">Draft<");
    expect(html).toContain(">Published<");
    // Alt-text inputs exist for uploaded media without a manual refresh.
    expect(html).toContain('name="alt"');
    expect(html).toContain("Add media before publishing.");
  });

  it("warns when the profile is private, with a link to the profile editor (finding 3)", () => {
    const html = render([twoAssets], false);
    expect(html).toContain("Your profile is private, so published works are not visible yet.");
    expect(html).toContain('href="/dashboard/profile"');
    // The hint must also sit next to the Publish button on draft works.
    const draft = work({ id: "w-d", title: "Draft work" });
    const withDraft = renderToStaticMarkup(
      createElement(PortfolioManager, {
        initial: [draft], heading: "Portfolio", intro: "Intro.", handle: "someone", profilePublished: false,
      }),
    );
    expect(withDraft).toContain("Your profile is private — publishing this work will not make it visible until you publish your profile.");
  });

  it("shows no private-profile guidance when the profile is published", () => {
    const html = render([work({ id: "w-d", title: "Draft work" })], true);
    expect(html).not.toContain("Your profile is private");
    expect(html).toContain("Preview public page");
    expect(html).toContain('href="/artists/someone"');
  });

  it("routes the card link to the profile editor while the profile is private", () => {
    const published = work({ id: "w-p", title: "Published work", published: true });
    const html = render([published], false);
    // The work is published but the artist page is unreachable: the card
    // must not claim "View public page" — it must send the member to the
    // profile switch that actually gates visibility.
    expect(html).not.toContain("View public page");
    expect(html).toContain("Publish your profile first");
    expect(html).toContain('href="/dashboard/profile"');
  });
});

describe("loadManagedPortfolio remount stamp", () => {
  type ItemRow = { id: string; title: string; description: string; year: number | null; tags: string[]; published: boolean; updated_at: string };
  type AssetRow = { id: string; portfolio_item_id: string; path: string; alt_text: string; content_type: string; width: number; height: number; position: number };

  function fakeClient(items: ItemRow[], assets: AssetRow[], signedUrl: string) {
    const itemsChain = {
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => ({
              order: () => Promise.resolve({ data: items, error: null }),
            }),
          }),
        }),
      }),
    };
    const assetsChain = {
      select: () => ({
        in: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: assets, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    return {
      from: (table: string) => {
        if (table === "profiles")
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { handle: "someone", published: true } }) }) }) };
        if (table === "portfolio_items") return itemsChain;
        if (table === "media_assets") return assetsChain;
        throw new Error(`unexpected table ${table}`);
      },
      storage: {
        from: () => ({ createSignedUrl: async () => ({ data: { signedUrl } }) }),
      },
    } as unknown as SupabaseClient;
  }

  const items: ItemRow[] = [{
    id: "w1", title: "T", description: "", year: null, tags: [], published: false, updated_at: "2026-10-30T00:00:00Z",
  }];
  const assets = (positions: number[]): AssetRow[] =>
    positions.map((position, i) => ({
      id: `a${i}`, portfolio_item_id: "w1", path: `p${i}`, alt_text: `alt ${i}`,
      content_type: "image/jpeg", width: 1, height: 1, position,
    }));

  it("changes when the media set or order changes", async () => {
    const one = await loadManagedPortfolio(fakeClient(items, assets([0]), "url"), "u1");
    const two = await loadManagedPortfolio(fakeClient(items, assets([0, 1]), "url"), "u1");
    expect(one.works[0].stamp).not.toBe(two.works[0].stamp);
    // Stamp carries id:position pairs so a reorder remounts the card.
    const reordered = await loadManagedPortfolio(fakeClient(items, assets([1, 0]), "url"), "u1");
    expect(reordered.works[0].stamp).not.toBe(two.works[0].stamp);
  });

  it("does not change when only the signed URL token churns", async () => {
    const first = await loadManagedPortfolio(fakeClient(items, assets([0]), "token-a"), "u1");
    const second = await loadManagedPortfolio(fakeClient(items, assets([0]), "token-b"), "u1");
    expect(first.works[0].stamp).toBe(second.works[0].stamp);
    expect(first.works[0].assets[0].previewUrl).toBe("token-a");
    expect(second.works[0].assets[0].previewUrl).toBe("token-b");
  });

  it("carries the published flag from the database row", async () => {
    const draft = await loadManagedPortfolio(fakeClient(items, [], "u"), "u1");
    expect(draft.works[0].published).toBe(false);
    const live = await loadManagedPortfolio(
      fakeClient([{ ...items[0], published: true, updated_at: "2026-10-30T01:00:00Z" }], [], "u"), "u1",
    );
    expect(live.works[0].published).toBe(true);
    expect(live.profilePublished).toBe(true);
  });
});
