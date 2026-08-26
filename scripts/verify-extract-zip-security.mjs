import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import extract from "extract-zip";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceFiles = [
  "pnpm-workspace.yaml",
  "backend/pnpm-workspace.yaml",
  "storefront/pnpm-workspace.yaml",
];
const maliciousArchive = Buffer.from(
  "UEsDBAoAAAAAAOI+Gl0Fr4RLEQAAABEAAAAGABwAZXNjYXBlVVQJAAMY1I5qGNSOanV4CwABBOgDAAAE6QMAAC4uLy4uL291dHNpZGUudHh0UEsBAh4DCgAAAAAA4j4aXQWvhEsRAAAAEQAAAAYAGAAAAAAAAAAAAP+hAAAAAGVzY2FwZVVUBQADGNSOanV4CwABBOgDAAAE6QMAAFBLBQYAAAAAAQABAEwAAABRAAAAAAA=",
  "base64",
);
const safeArchive = Buffer.from(
  "UEsDBAoAAAAAAOI+Gl0KPM9PBQAAAAUAAAAKABwAaW5zaWRlLnR4dFVUCQADGNSOahjUjmp1eAsAAQToAwAABOkDAABzYWZlClBLAwQKAAAAAADiPhpdlGkEBwoAAAAKAAAABQAcAGFsaWFzVVQJAAMY1I5qGNSOanV4CwABBOgDAAAE6QMAAGluc2lkZS50eHRQSwECHgMKAAAAAADiPhpdCjzPTwUAAAAFAAAACgAYAAAAAAABAAAAtIEAAAAAaW5zaWRlLnR4dFVUBQADGNSOanV4CwABBOgDAAAE6QMAAFBLAQIeAwoAAAAAAOI+Gl2UaQQHCgAAAAoAAAAFABgAAAAAAAAAAAD/oUkAAABhbGlhc1VUBQADGNSOanV4CwABBOgDAAAE6QMAAFBLBQYAAAAAAgACAJsAAACSAAAAAAA=",
  "base64",
);

const assertPuppeteerBuildsBlocked = async () => {
  for (const relativePath of workspaceFiles) {
    const contents = await readFile(join(repositoryRoot, relativePath), "utf8");
    assert.match(
      contents,
      /^\s*puppeteer:\s*false\s*$/mu,
      `${relativePath} must explicitly block Puppeteer install scripts`,
    );
  }
};

const assertMissing = async (path) => {
  await assert.rejects(lstat(path), (error) => {
    assert.equal(error?.code, "ENOENT");
    return true;
  });
};

const verifyArchiveBehavior = async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "extract-zip-security-"));
  const maliciousPath = join(temporaryRoot, "malicious.zip");
  const maliciousDestination = join(temporaryRoot, "malicious");
  const safePath = join(temporaryRoot, "safe.zip");
  const safeDestination = join(temporaryRoot, "safe");

  try {
    await writeFile(maliciousPath, maliciousArchive);
    await assert.rejects(
      extract(maliciousPath, { dir: maliciousDestination }),
      /Out of bound symlink target/,
    );
    await assertMissing(join(maliciousDestination, "escape"));

    await writeFile(safePath, safeArchive);
    await extract(safePath, { dir: safeDestination });
    assert.equal(
      await readFile(join(safeDestination, "inside.txt"), "utf8"),
      "safe\n",
    );
    assert.equal(await readlink(join(safeDestination, "alias")), "inside.txt");
    assert.equal(
      await readFile(join(safeDestination, "alias"), "utf8"),
      "safe\n",
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
};

await assertPuppeteerBuildsBlocked();
await verifyArchiveBehavior();

console.log(
  "Extract-zip symlink containment and Puppeteer build blocking verified.",
);
