import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const storagePath = require.resolve(
  "@medusajs/workflow-engine-redis/dist/utils/workflow-orchestrator-storage.js",
  { paths: [fileURLToPath(new URL("../backend/", import.meta.url))] },
);
const source = await readFile(storagePath, "utf8");
const correctedTimestamp =
  "const scheduledFor = new Date(job.opts.prevMillis ?? job.timestamp + job.delay);";
const enqueueTimestamp = "const scheduledFor = new Date(job.timestamp);";
const delayOnlyTimestamp =
  "const scheduledFor = new Date(job.timestamp + job.delay);";

if (
  !source.includes(correctedTimestamp) ||
  source.includes(enqueueTimestamp) ||
  source.includes(delayOnlyTimestamp)
) {
  throw new Error(
    "The Redis workflow worker must report BullMQ's delayed execution timestamp.",
  );
}

console.log("✓ Redis workflow jobs report their delayed execution timestamp");
