// Live stack journey using real SSR cookies and the team's HTTP contracts.
import sharp from "sharp";
import { runtime, signup, request, assert, cleanupAccount } from "./http-harness.mjs";
import { sampleContent } from "./fixtures/sample-data.mjs";
import { checked } from "./seed-common.mjs";
let config;
let member;
try {
  config = runtime({ cleanup: true });
  member = await signup(config, "e2e");
  assert(Boolean(member.user && member.session), "public signup returns a confirmed session");
  const { base } = config;
  const api = (path, opts = {}) => request(base, path, { cookie: member.cookie, ...opts });
  // The team saves profiles with a server action. Use its owner-RLS data contract here;
  // the browser smoke separately checks that the real forms hydrate.
  checked(await member.client.from("profiles").update({ category_id: 1, account_kind: "individual",
    display_name: "Sample E2E Artist", bio: "Temporary sample journey account", published: true,
    contact_email: "sample.e2e@example.test", open_to_collaborate: true }).eq("id", member.user.id), "complete profile");
  assert((await api("/dashboard")).status === 200, "onboarded dashboard loads");
  const work = await api("/api/portfolio/items", { method: "POST", body: { title: "Sample E2E Work", description: "Temporary generated artwork", year: 2026, tags: ["sample"] } });
  assert(work.status === 201 && work.json?.item?.id, `create draft work: ${work.status}`);
  const itemId = work.json.item.id;
  const bytes = await sharp({ create: { width: 240, height: 180, channels: 3, background: "#8e5844" } }).png().toBuffer();
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), "sample.png");
  form.append("itemId", itemId);
  form.append("altText", "Sample data: generated ochre rectangle");
  const upload = await api("/api/media/upload", { method: "POST", body: form });
  assert(upload.status === 201, `upload PNG through validation: ${upload.status}`);
  const publish = await api("/api/media/publish", { method: "POST", body: { itemId, altText: "Sample data: generated ochre rectangle" } });
  assert(publish.status === 200, `publish public derivatives: ${publish.status}`);
  assert((await request(base, `/items/${itemId}`)).status === 200, "anonymous work detail loads");
  const media = checked(await member.client.from("media_assets").select("bucket,path").eq("portfolio_item_id", itemId).eq("bucket", "media"), "load derivatives");
  assert(media.length >= 2, "published work has public derivatives");
  const object = await fetch(`${config.url}/storage/v1/object/public/media/${media[0].path}`, { signal: AbortSignal.timeout(30000) });
  assert(object.status === 200, "public storage derivative downloads");
  const event = await api("/api/events", { method: "POST", body: { title: "Sample E2E Open Studio", description: "Temporary sample event", location: "Sample venue, Adelaide", category_id: 1, starts_at: new Date(Date.now() + 7 * 86400000).toISOString(), ends_at: new Date(Date.now() + 7 * 86400000 + 7200000).toISOString() } });
  assert(event.status === 201 && event.json?.event?.id, `create event: ${event.status}`);
  const eventId = event.json.event.id;
  const published = await api(`/api/events/${eventId}`, { method: "PATCH", body: { status: "published" } });
  assert(published.status === 200, `publish event: ${published.status}`);
  const registration = await api(`/api/events/${eventId}/register`, { method: "POST" });
  assert(registration.status === 200 && registration.json?.status === "confirmed", "free registration confirms without an order");
  const cancelled = await api(`/api/registrations/${registration.json.registrationId}/cancel`, { method: "POST" });
  assert(cancelled.status === 200, "free registration cancels");
  const like = await api("/api/likes", { method: "POST", body: { subjectType: "event", subjectId: eventId } });
  assert(like.status === 200 && like.json?.liked === true, "member can like public event");
  const view = await api("/api/views", { method: "POST", body: { subjectType: "event", subjectId: eventId } });
  assert(view.status === 200 && view.json?.ok === true, "member view records");
  // A paid sample fixture is deliberately provisioned by the seed, never through
  // client-supplied price fields (the team's event editor keeps those immutable).
  const paid = checked(await config.publicClient.from("events").select("id").in("id", sampleContent().events.map((e) => e.id)).gt("price_cents", 0).gt("starts_at", new Date().toISOString()).limit(1), "load paid sample")[0];
  assert(Boolean(paid), "upcoming paid sample exists");
  let order = await api(`/api/events/${paid.id}/register`, { method: "POST" });
  assert(order.status === 200 && order.json?.status === "pending" && order.json?.orderId, "paid registration creates pending order");
  assert((await api(`/dashboard/orders/${order.json.orderId}`)).status === 200, "stub checkout page loads");
  const failed = await api(`/api/orders/${order.json.orderId}/settle`, { method: "POST", body: { outcome: "failed" } });
  assert(failed.status === 200 && failed.json?.registrationStatus === "payment_failed", "stub failure preserves retry state");
  order = await api(`/api/events/${paid.id}/register`, { method: "POST" });
  assert(order.status === 200 && order.json?.orderId, "payment retry creates an order");
  const settled = await api(`/api/orders/${order.json.orderId}/settle`, { method: "POST", body: { outcome: "succeeded" } });
  assert(settled.status === 200 && settled.json?.registrationStatus === "confirmed", "stub success confirms paid registration");
  const replay = await api(`/api/orders/${order.json.orderId}/settle`, { method: "POST", body: { outcome: "failed" } });
  assert(replay.status === 200 && replay.json?.orderStatus === "succeeded", "settled order ignores conflicting replay");
  console.log(`E2E passed against ${base}`);
} catch (err) { console.error(err.message); process.exitCode = 1; }
finally {
  if (member?.user?.id && config?.admin) {
    try { await cleanupAccount(config.admin, member.user.id); }
    catch (err) { console.error(`Cleanup failed: ${err.message}`); process.exitCode = 1; }
  }
}
