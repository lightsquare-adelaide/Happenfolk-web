import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Hero } from "../src/components/home/hero";
import { ArtistTile } from "../src/components/discovery/cards";

it("serves the small derivative on narrow phones and prioritizes only the lead hero image", () => {
  const html = renderToStaticMarkup(createElement(Hero, { works: [0, 1, 2].map((n) => ({
    id: `work-${n}`, title: `Work ${n}`, artistHandle: "artist", artistName: "Artist",
    coverUrl: `/work-${n}-medium.webp`, smallCoverUrl: `/work-${n}-small.webp`,
    smallWidth: 480, width: 1080, height: 810, alt: `Work ${n}`,
  })) }));
  expect(html).toContain('media="(max-width: 600px)"');
  expect(html).toContain('/work-0-small.webp');
  expect(html).toContain('sizes="');
  expect((html.match(/<img[^>]+>/g) ?? []).filter((img) => img.includes('fetchPriority="high"'))).toHaveLength(1);
  const images = html.match(/<img[^>]+>/g)!;
  expect(images[0]).toContain('loading="eager"');
  expect(images[0]).not.toContain('loading="lazy"');
});

it("keeps an artist avatar out of intrinsic layout inside a reserved square", () => {
  const html = renderToStaticMarkup(createElement(ArtistTile, { artist: {
    id: "artist", handle: "artist", displayName: "Artist", categoryId: null,
    avatarUrl: "/avatar.webp", publishedItems: 1, trending: false,
  } }));
  expect(html).toMatch(/class="[^"]*relative[^"]*aspect-square/);
  expect(html).toMatch(/<img[^>]+class="[^"]*absolute inset-0/);
  expect(html).toContain('width="320" height="320"');
});
