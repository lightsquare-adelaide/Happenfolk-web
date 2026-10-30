// Explicit operator opt-in only. Never reads .env.local or discovers remote credentials.
import { remoteClient, seedData } from "./seed-common.mjs";
import { seedMedia } from "./seed-media.mjs";
try {
  const client = remoteClient();
  const counts = await seedData(client, process.env.SEED_PASSWORD);
  await seedMedia(client);
  console.log(`Sample seed complete: ${counts.profiles} artists, ${counts.events} events, ${counts.items} works.`);
} catch (err) { console.error(err.message); process.exitCode = 1; }
