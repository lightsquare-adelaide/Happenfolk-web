// Deletes only the exact fictional emails carrying this package's sample marker.
import { remoteClient, removeSampleData } from "./seed-common.mjs";
try {
  console.log(`Removed ${await removeSampleData(remoteClient())} marked sample accounts and their content.`);
} catch (err) { console.error(err.message); process.exitCode = 1; }
