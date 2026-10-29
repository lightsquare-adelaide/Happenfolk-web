// Synthetic Adelaide demonstrations; no real people, venues or contact addresses.
export const SAMPLE_TAG = "happenfolk-parity-x-v1";
export const sampleId = (kind, n) => `fa00000${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const names = ["Alex", "Blair", "Casey", "Drew", "Eden", "Finley", "Harper", "Indigo"];
const disciplines = ["Music", "Photography", "Visual Arts", "Performance", "Design", "Film", "Food"];
const places = ["Adelaide", "Port Adelaide", "Norwood", "Unley", "Prospect"];
export const artists = Array.from({ length: 40 }, (_, i) => ({
  id: sampleId(1, i + 1), email: `sample.artist.${String(i + 1).padStart(2, "0")}@example.test`,
  handle: `sample_artist_${String(i + 1).padStart(2, "0")}`,
  display_name: `Sample ${names[i % names.length]} Studio ${i + 1}`,
  account_kind: i % 5 === 0 ? "organisation" : "individual", category_id: i % 7 + 1,
  bio: `Sample data: an independent ${disciplines[i % 7].toLowerCase()} practice exploring local stories and shared creative work. This studio is fictional.`,
  headline: `Sample ${disciplines[i % 7]} practitioner`, location: places[i % places.length],
  website: "https://example.test", contact_email: `sample.artist.${String(i + 1).padStart(2, "0")}@example.test`,
  published: i < 38, is_hidden: i === 37, open_to_collaborate: i % 3 === 0,
}));
export function sampleContent(profileIds = artists.map((a) => a.id), now = Date.now()) {
  const events = Array.from({ length: 84 }, (_, i) => {
    const category = i % 7;
    const start = now + (i % 6 === 0 ? -14 - i : 2 + i) * 86400000;
    return {
      id: sampleId(2, i + 1), host_id: profileIds[i % 37], category_id: category + 1,
      title: `Sample ${disciplines[category]} ${["Open Studio", "Workshop", "Showcase", "Evening"][i % 4]} ${i + 1}`,
      description: "Sample data: a fictional gathering for Adelaide creatives to share practice, meet collaborators and explore new work. No tickets are sold for this demonstration.",
      location: `Sample venue, ${places[i % places.length]}`,
      starts_at: new Date(start).toISOString(), ends_at: new Date(start + 7200000).toISOString(),
      price_cents: i % 3 === 0 ? 2500 : 0, capacity: 30 + i % 5 * 10,
      status: i >= 80 ? "draft" : "published", is_hidden: i === 78 || i === 79,
      open_to_collaborate: i % 4 === 0,
    };
  });
  const items = Array.from({ length: 120 }, (_, i) => ({
    id: sampleId(3, i + 1), profile_id: profileIds[Math.floor(i / 3)],
    title: `Sample ${disciplines[Math.floor(i / 3) % 7]} Study ${i + 1}`,
    description: "Sample data: a fictional portfolio study. The illustration is a generated placeholder, not a photograph of a real work.",
    media_kind: "image", published: false, is_hidden: i === 110,
    year: 2026, tags: ["sample", "adelaide"], position: i % 3,
  }));
  const media = items.flatMap((item, i) => ["medium", "small"].map((variant, v) => ({
    id: sampleId(4, i * 2 + v + 1), portfolio_item_id: item.id,
    bucket: "media", path: `${item.profile_id}/sample/${item.id}-${variant}.webp`,
    content_type: "image/webp", variant, position: 0,
    width: variant === "medium" ? 960 : 320, height: variant === "medium" ? 720 : 240,
    alt_text: "Sample data: generated geometric illustration for a fictional creative study",
  })));
  const collaborators = events.filter((_, i) => i % 2 === 0).map((e, i) => ({
    event_id: e.id, profile_id: profileIds[(i + 1) % 37], role: "collaborator",
  })).filter((r) => events.find((e) => e.id === r.event_id).host_id !== r.profile_id);
  return { events, items, media, collaborators };
}
