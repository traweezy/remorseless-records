import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

// The verifier is mounted from the checked-out source, never loaded from the
// image being evaluated. No network, writable root, credentials or preload.
export const collectBracesImageProof = async (
  execute,
  host,
  imageId,
  cleanup = execute
) => {
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/u)
  assert.match(host, /^unix:\/\/\/[^\s\u0000-\u001f\u007f]+$/u)
  const scripts = dirname(dirname(fileURLToPath(import.meta.url)))
  assert.ok(!scripts.includes(","))
  let container
  try {
    container = (
      await execute(
        "docker",
        [
          "--host",
          host,
          "create",
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "32",
          "--memory",
          "256m",
          "--cpus",
          "1",
          "--user",
          "1000:1000",
          "--env",
          "NODE_OPTIONS=",
          "--env",
          "NODE_PATH=",
          "--env",
          "LD_PRELOAD=",
          "--mount",
          `type=bind,src=${scripts},dst=/rr-verifier,readonly`,
          "--entrypoint",
          "/usr/local/bin/node",
          imageId,
          "/rr-verifier/verify-braces-image.mjs",
        ],
        30000
      )
    )
      .toString()
      .trim()
    assert.match(container, /^[a-f0-9]{64}$/u)
    const source = await execute(
      "docker",
      ["--host", host, "start", "--attach", container],
      90000
    )
    const status = (
      await execute(
        "docker",
        [
          "--host",
          host,
          "inspect",
          "--format",
          "{{.State.Status}} {{.State.ExitCode}}",
          container,
        ],
        30000
      )
    )
      .toString()
      .trim()
    assert.equal(status, "exited 0")
    return JSON.parse(source.toString())
  } finally {
    if (/^[a-f0-9]{64}$/u.test(container ?? ""))
      await cleanup(
        "docker",
        ["--host", host, "rm", "--force", container],
        30000
      )
  }
}
