// Preview-only demo data for client feedback sessions. NOT for production.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_PASSWORD=... \
//     node scripts/seed-preview.mjs
//
// Creates sample artists (all @happenfolk.demo), their works, events, likes
// and page views, plus a `client@happenfolk.demo` account for the client.
// Images are generated abstract placeholders, fixed per seed so reruns match.
// Run against a fresh database (`supabase db reset`); it is not idempotent.
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DEMO_PASSWORD) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD.");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CATEGORY = { music: 1, photography: 2, "visual-arts": 3, performance: 4, design: 5, film: 6, food: 7 };

const ARTISTS = [
  { handle: "ines_varga", name: "Ines Varga", cat: "photography", bio: "Photographer working along the Gulf St Vincent coastline. Long exposures, salt flats and the light just after the tide turns.",
    works: [["Salt Lines", "Twelve long exposures from the Port Gawler salt flats."], ["Low Water", "Tidal pools at Semaphore, shot at dawn over one winter."], ["Jetty Studies", "The Henley Beach jetty in four seasons."], ["Grey Hour", "A series about the twenty minutes before sunrise."]] },
  { handle: "kofi_mensah", name: "Kofi Mensah", cat: "music", bio: "Guitarist and producer. Highlife roots, Adelaide basement shows, and a lot of borrowed amplifiers.",
    works: [["Live at the Wheatsheaf", "Recorded on a Sunday afternoon with a four-piece band."], ["Rehearsal Room Sessions", "Stripped-back versions of new songs."], ["Port Road EP artwork", "Cover art made with Lien Tran."]] },
  { handle: "lien_tran", name: "Lien Tran", cat: "visual-arts", bio: "Screen printer and illustrator based in Bowden. Two colours at a time, always by hand.",
    works: [["Bowden Panels", "Six large screen-printed panels for the open studio."], ["Market Day", "Illustrations from the Adelaide Central Market."], ["Two Colour Studies", "Small prints exploring overlap and misregistration."], ["Night Tram", "A risograph zine about the last tram home."]] },
  { handle: "dana_whitlock", name: "Dana Whitlock", cat: "performance", bio: "Physical theatre and movement. Making work for small rooms and outdoor spaces.",
    works: [["Weathering", "A solo piece performed in the Botanic Garden."], ["Small Rooms", "Rehearsal stills from a duet in progress."]] },
  { handle: "ravi_sethuraman", name: "Ravi Sethuraman", cat: "design", bio: "Type and poster designer. Gig posters for Adelaide venues since 2019.",
    works: [["Fringe Posters 2026", "A set of twelve posters for Fringe shows."], ["Display Face Specimen", "A condensed display typeface in progress."], ["Venue Signage", "Wayfinding for a Hindley Street venue."]] },
  { handle: "harriet_coole", name: "Harriet Coole", cat: "film", bio: "Short-film director and editor. Stories about country towns and the people who stay.",
    works: [["Stills from 'Mallee'", "Frames from a short film shot near Pinnaroo."], ["Edit Suite Diary", "Work-in-progress stills from the new cut."], ["Behind the Camera", "On set with a crew of four."]] },
  { handle: "bowden_open_studio", name: "Bowden Open Studio", cat: "visual-arts", kind: "organisation", bio: "A shared studio and gallery space for independent artists in Bowden. Open studio nights every month.",
    works: [["The Studio", "Our shared workspace on a Thursday night."], ["Last Month's Show", "Highlights from the September open studio."]] },
];

const day = 24 * 60 * 60 * 1000;
const at = (days, hour) => {
  const d = new Date(Date.now() + days * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const EVENTS = [
  { host: "kofi_mensah", with: ["lien_tran"], cat: "music", title: "Low Tide Sessions", days: 3, hour: 19, price: 0, cap: 80,
    desc: "An evening of live music on the Semaphore foreshore. Kofi Mensah plays a set of new songs with a four-piece band, with prints by Lien Tran on show in the foyer.\n\nBring a jacket; it gets windy after sunset." },
  { host: "bowden_open_studio", with: ["lien_tran", "ravi_sethuraman"], cat: "visual-arts", title: "Bowden Open Studio Night", days: 6, hour: 18, price: 0, cap: 120,
    desc: "Twelve artists open their studios for one night. Screen printing demonstrations, new posters, and work for sale directly from the artists." },
  { host: "harriet_coole", with: ["dana_whitlock"], cat: "film", title: "Short Film Night Vol. 4", days: 12, hour: 19, price: 1200, cap: 60,
    desc: "Five new short films by South Australian makers, followed by a Q&A with the directors. Includes the first screening of 'Mallee'." },
  { host: "ines_varga", with: [], cat: "photography", title: "Salt Lines: Exhibition Opening", days: 16, hour: 18, price: 0, cap: 150,
    desc: "Opening night for Salt Lines, a photographic series made on the Port Gawler salt flats over two years." },
  { host: "dana_whitlock", with: ["kofi_mensah"], cat: "performance", title: "Weathering (Outdoor Performance)", days: 21, hour: 17, price: 1500, cap: 40,
    desc: "A movement piece performed outdoors at dusk, with a live score by Kofi Mensah. Seating is on the grass." },
  { host: "ravi_sethuraman", with: [], cat: "design", title: "Poster Swap & Print Fair", days: 27, hour: 11, price: 500, cap: 200,
    desc: "Bring a poster, take a poster. Local designers and printers selling small runs, with a live risograph station." },
];

// Abstract placeholder artwork rendered locally, so seeding needs no network.
const PALETTES = [
  ["#1d3557", "#e63946", "#f1faee", "#a8dadc"], ["#264653", "#2a9d8f", "#e9c46a", "#f4a261"],
  ["#0b0b0c", "#e5006d", "#f4f4f5", "#52525b"], ["#3d405b", "#e07a5f", "#f4f1de", "#81b29a"],
  ["#2b2d42", "#8d99ae", "#edf2f4", "#ef233c"], ["#355070", "#6d597a", "#b56576", "#eaac8b"],
  ["#283618", "#606c38", "#fefae0", "#dda15e"], ["#001219", "#0a9396", "#e9d8a6", "#ee9b00"],
];
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
async function image(seed, w, h) {
  const r = rng(seed);
  const [bg, ...ink] = PALETTES[Math.floor(r() * PALETTES.length)];
  const shapes = Array.from({ length: 4 + Math.floor(r() * 5) }, () => {
    const fill = ink[Math.floor(r() * ink.length)];
    const [x, y, s] = [r() * w, r() * h, (0.15 + r() * 0.45) * Math.min(w, h)];
    return r() < 0.5
      ? `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${fill}" opacity="${0.6 + r() * 0.4}"/>`
      : `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s * (0.3 + r())}" fill="${fill}" opacity="${0.6 + r() * 0.4}" transform="rotate(${Math.floor(r() * 4) * 15 - 30} ${x} ${y})"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${shapes}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function upload(bucket, path, data) {
  const { error } = await db.storage.from(bucket).upload(path, data, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function createMember(email, meta) {
  const { user } = must(
    await db.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: meta }),
    `create ${email}`,
  );
  return user.id;
}

const ids = {};
for (const a of ARTISTS) {
  const id = await createMember(`${a.handle}@happenfolk.demo`, {
    handle: a.handle, display_name: a.name, account_kind: a.kind ?? "individual", category_id: String(CATEGORY[a.cat]),
  });
  ids[a.handle] = id;
  const avatar = `${id}/avatar.jpg`;
  await upload("avatars", avatar, await image(`av-${a.handle}`, 256, 256));
  must(await db.from("profiles").update({ bio: a.bio, published: true, avatar_path: avatar }).eq("id", id), "profile");

  for (const [i, [title, description]] of a.works.entries()) {
    const item = must(
      await db.from("portfolio_items").insert({ profile_id: id, title, description, media_kind: "image", published: true, published_at: new Date().toISOString() }).select("id").single(),
      "work",
    );
    const [w, h] = [[1080, 1080], [1080, 1350], [1080, 720]][i % 3];
    // Mirrors #20's pipeline: private original in drafts, public display copy in media.
    const data = await image(`${a.handle}-${i}`, w, h);
    const row = { portfolio_item_id: item.id, alt_text: `${title} by ${a.name}`, content_type: "image/jpeg", width: w, height: h, position: 0 };
    const original = `${id}/${item.id}/original.jpg`;
    const display = `${id}/${item.id}/medium.jpg`;
    await upload("drafts", original, data);
    await upload("media", display, data);
    must(
      await db.from("media_assets").insert([
        { ...row, path: original, bucket: "drafts", variant: "original" },
        { ...row, path: display, bucket: "media", variant: "medium" },
      ]),
      "media",
    );
  }
  console.log(`artist ${a.handle}`);
}

const eventIds = [];
for (const [i, e] of EVENTS.entries()) {
  const cover = `${ids[e.host]}/event-${i}.jpg`;
  await upload("covers", cover, await image(`event-${i}`, 1360, 765));
  const ev = must(
    await db.from("events").insert({
      host_id: ids[e.host], category_id: CATEGORY[e.cat], title: e.title, description: e.desc, status: "published",
      starts_at: at(e.days, e.hour), ends_at: at(e.days, e.hour + 3), price_cents: e.price, capacity: e.cap, cover_path: cover,
    }).select("id").single(),
    "event",
  );
  eventIds.push(ev.id);
  for (const h of e.with) {
    must(await db.from("event_collaborators").insert({ event_id: ev.id, profile_id: ids[h], role: "collaborator" }), "collab");
  }
  console.log(`event ${e.title}`);
}

// Likes and views so counts and the trending order are not all zero.
const members = Object.values(ids);
const likes = [];
eventIds.forEach((eid, i) => members.slice(0, members.length - i).forEach((m) => likes.push({ member_id: m, subject_type: "event", subject_id: eid })));
must(await db.from("interactions").insert(likes), "likes");
const views = [];
const weights = [40, 32, 25, 18, 12, 8, 5];
Object.values(ids).forEach((pid, i) => {
  for (let n = 0; n < weights[i]; n++) views.push({ subject_type: "profile", subject_id: pid });
});
eventIds.forEach((eid, i) => {
  for (let n = 0; n < 30 - i * 4; n++) views.push({ subject_type: "event", subject_id: eid });
});
must(await db.from("page_views").insert(views), "views");

await createMember("client@happenfolk.demo", { handle: "client_demo", display_name: "Client Demo" });
console.log("done: sign in as client@happenfolk.demo with DEMO_PASSWORD");
