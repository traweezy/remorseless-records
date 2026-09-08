import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"

import {
  installGitHooks,
  isReviewedLegacyHook,
  parseHookInstallArguments,
} from "./install-git-hooks.mjs"
import { hookEnvironment, runGitHook } from "./run-git-hook.mjs"

// Full reviewed legacy wrapper, stored as inert fixture text only. Neither the
// installed Lefthook nor this wrapper is ever executed by these tests.
const legacyTemplate = `#!/bin/sh

if [ "$LEFTHOOK_VERBOSE" = "1" -o "$LEFTHOOK_VERBOSE" = "true" ]; then
  set -x
fi

if [ "$LEFTHOOK" = "0" ]; then
  exit 0
fi

call_lefthook()
{
  if test -n "$LEFTHOOK_BIN"
  then
    "$LEFTHOOK_BIN" "$@"
  elif lefthook -h >/dev/null 2>&1
  then
    lefthook "$@"
  elif <REPOSITORY_ROOT>/node_modules/.pnpm/lefthook-linux-x64@2.1.10/node_modules/lefthook-linux-x64/bin/lefthook -h >/dev/null 2>&1
  then
    <REPOSITORY_ROOT>/node_modules/.pnpm/lefthook-linux-x64@2.1.10/node_modules/lefthook-linux-x64/bin/lefthook "$@"
  else
    dir="$(git rev-parse --show-toplevel)"
    osArch=$(uname | tr '[:upper:]' '[:lower:]')
    cpuArch=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')
    if test -f "$dir/node_modules/lefthook-\${osArch}-\${cpuArch}/bin/lefthook"
    then
      "$dir/node_modules/lefthook-\${osArch}-\${cpuArch}/bin/lefthook" "$@"
    elif test -f "$dir/node_modules/@evilmartians/lefthook/bin/lefthook-\${osArch}-\${cpuArch}/lefthook"
    then
      "$dir/node_modules/@evilmartians/lefthook/bin/lefthook-\${osArch}-\${cpuArch}/lefthook" "$@"
    elif test -f "$dir/node_modules/@evilmartians/lefthook-installer/bin/lefthook"
    then
      "$dir/node_modules/@evilmartians/lefthook-installer/bin/lefthook" "$@"
    elif test -f "$dir/node_modules/lefthook/bin/index.js"
    then
      "$dir/node_modules/lefthook/bin/index.js" "$@"
    elif go tool lefthook -h >/dev/null 2>&1
    then
      go tool lefthook "$@"
    elif bundle exec lefthook -h >/dev/null 2>&1
    then
      bundle exec lefthook "$@"
    elif yarn lefthook -h >/dev/null 2>&1
    then
      yarn lefthook "$@"
    elif pnpm lefthook -h >/dev/null 2>&1
    then
      pnpm lefthook "$@"
    elif swift package lefthook >/dev/null 2>&1
    then
      swift package --build-path .build/lefthook --disable-sandbox lefthook "$@"
    elif command -v mint >/dev/null 2>&1
    then
      mint run csjones/lefthook-plugin "$@"
    elif uv run lefthook -h >/dev/null 2>&1
    then
      uv run lefthook "$@"
    elif mise exec -- lefthook -h >/dev/null 2>&1
    then
      mise exec -- lefthook "$@"
    elif devbox run lefthook -h >/dev/null 2>&1
    then
      devbox run lefthook "$@"
    else
      echo "Can't find lefthook in PATH"
    fi
  fi
}

call_lefthook run "pre-commit" "$@"
`
const legacy = (name, root) =>
  legacyTemplate
    .replaceAll("<REPOSITORY_ROOT>", root)
    .replace('run "pre-commit"', `run "${name}"`)

const fakePnpm = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const events = path.join(process.cwd(), "hook-events");
fs.appendFileSync(events, JSON.stringify({args, cwd:process.cwd(), pm:process.env.pnpm_config_pm_on_fail, deps:process.env.pnpm_config_verify_deps_before_run, corepack:process.env.COREPACK_ENABLE_NETWORK})+"\\n");
if (process.env.pnpm_config_pm_on_fail !== "error" || process.env.pnpm_config_verify_deps_before_run !== "error") process.exit(96);
const mode = process.env.RR_HOOK_FIXTURE_MODE;
if (args[0] === "--version") {
  if (mode === "version-failure") process.exit(9);
  if (mode === "version-hang") setInterval(()=>{},1000);
  else if (mode === "version-huge") process.stdout.write("x".repeat(8192));
  else if (mode === "version-stderr-huge") { process.stderr.write("x".repeat(8192)); console.log("11.17.0"); }
  else console.log(process.env.RR_HOOK_FIXTURE_VERSION ?? "11.17.0");
} else if (mode === "qa-hang") { fs.writeFileSync("child-ready", String(process.pid)); setInterval(()=>{},1000); }
else if ((mode === "qa-failure" && args[1] === "qa:lint") || (mode === "coverage-failure" && args[1] === "qa:storefront:coverage")) process.exit(7);
`

const fixture = async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), "remorseless git hooks "))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^GIT_|^LEFTHOOK|^pnpm_config_|^PNPM_CONFIG_/u.test(name)
    )
  )
  Object.assign(environment, {
    PATH: `${join(root, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    CI: "false",
    NODE_ENV: "test",
  })
  const git = (args, extra = {}) =>
    spawnSync("git", args, {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 32_768,
      ...extra,
    })
  assert.equal(git(["init", "--quiet", "--initial-branch=fixture"]).status, 0)
  for (const directory of ["bin", "scripts", "githooks", "nested"])
    await fs.mkdir(join(root, directory))
  await fs.writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "remorseless-records",
      packageManager: "pnpm@11.17.0",
    })
  )
  for (const name of ["install-git-hooks.mjs", "run-git-hook.mjs"])
    await fs.copyFile(
      new URL(name, import.meta.url),
      join(root, "scripts", name)
    )
  for (const name of ["pre-commit", "pre-push"])
    await fs.copyFile(
      new URL(`../githooks/${name}`, import.meta.url),
      join(root, "githooks", name)
    )
  await fs.writeFile(join(root, "bin", "pnpm"), fakePnpm, { mode: 0o700 })
  await fs.writeFile(
    join(root, "bin", "lefthook"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync("forbidden-lefthook", "called");process.exit(0)\n`,
    { mode: 0o700 }
  )
  const hooks = join(root, ".git", "hooks")
  const options = { root, environment }
  const cli = (file, args = [], extra = {}) =>
    spawnSync(process.execPath, [join(root, "scripts", file), ...args], {
      cwd: join(root, "nested"),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 32_768,
      ...extra,
    })
  const events = async () => {
    try {
      return (await fs.readFile(join(root, "hook-events"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    } catch (error) {
      if (error.code === "ENOENT") return []
      throw error
    }
  }
  const addLegacy = async () => {
    for (const name of ["pre-commit", "pre-push"])
      await fs.writeFile(join(hooks, name), legacy(name, root), { mode: 0o755 })
  }
  return { root, hooks, environment, options, git, cli, events, addLegacy }
}
const missing = async (path) =>
  assert.rejects(fs.lstat(path), { code: "ENOENT" })
const contents = async (input) =>
  Promise.all(
    ["pre-commit", "pre-push"].map((name) =>
      fs.readFile(join(input.hooks, name), "utf8")
    )
  )

test("installation arguments are strict and immutable", () => {
  assert.deepEqual(parseHookInstallArguments([]), {
    migrateLegacy: false,
    help: false,
  })
  assert.equal(
    parseHookInstallArguments(["--migrate-legacy"]).migrateLegacy,
    true
  )
  assert.equal(parseHookInstallArguments(["--help"]).help, true)
  assert.ok(Object.isFrozen(parseHookInstallArguments([])))
  for (const args of [
    ["--"],
    ["--force"],
    ["--help", "--migrate-legacy"],
    ["--migrate-legacy", "--migrate-legacy"],
  ])
    assert.throws(() => parseHookInstallArguments(args))
})

test("legacy recognition checks complete bodies and exactly two trusted roots", () => {
  for (const name of ["pre-commit", "pre-push"]) {
    const source = legacy(name, "/trusted/repository path")
    assert.equal(
      isReviewedLegacyHook(name, source, "/trusted/repository path"),
      true
    )
    for (const edited of [
      source + "# edit\n",
      source.replace("exit 0", "exit 1"),
      source.replace("2.1.10", "2.1.12"),
      source.replace("/trusted/repository path", "/elsewhere"),
      source + "/trusted/repository path",
    ])
      assert.equal(
        isReviewedLegacyHook(name, edited, "/trusted/repository path"),
        false
      )
  }
  for (const args of [
    ["other", "", "/root"],
    ["pre-commit", null, "/root"],
    ["pre-commit", "", null],
    ["pre-commit", "", "/"],
  ])
    assert.equal(isReviewedLegacyHook(...args), false)
})

test("fresh install is idempotent, preserves unrelated hooks/config, repairs owned mode", async (context) => {
  const input = await fixture(context)
  await fs.writeFile(join(input.hooks, "commit-msg"), "unrelated")
  const config = await fs.readFile(join(input.root, ".git", "config"))
  const result = await installGitHooks(input.options)
  assert.deepEqual(result, {
    event: "git.hooks.installed",
    changed: 2,
    backups: 0,
  })
  assert.ok(Object.isFrozen(result))
  assert.equal((await installGitHooks(input.options)).changed, 0)
  await fs.chmod(join(input.hooks, "pre-push"), 0o600)
  assert.equal((await installGitHooks(input.options)).changed, 1)
  for (const name of ["pre-commit", "pre-push"])
    assert.equal((await fs.stat(join(input.hooks, name))).mode & 0o777, 0o755)
  assert.equal(
    await fs.readFile(join(input.hooks, "commit-msg"), "utf8"),
    "unrelated"
  )
  assert.deepEqual(
    await fs.readFile(join(input.root, ".git", "config")),
    config
  )
})

for (const field of ["CI", "NODE_ENV"])
  test(`prepare skips ${field} without Git/filesystem operations`, async () => {
    assert.equal(
      (
        await installGitHooks({
          root: "/not-present",
          environment: { [field]: field === "CI" ? "true" : "production" },
        })
      ).event,
      "git.hooks.install_skipped"
    )
  })

test("reviewed legacy migration requires consent and preserves original private backups", async (context) => {
  const input = await fixture(context)
  await input.addLegacy()
  const before = await contents(input)
  await assert.rejects(
    installGitHooks(input.options),
    /explicit --migrate-legacy/u
  )
  assert.deepEqual(await contents(input), before)
  const result = await installGitHooks({
    ...input.options,
    migrateLegacy: true,
  })
  assert.equal(result.backups, 2)
  for (const [index, name] of ["pre-commit", "pre-push"].entries()) {
    const path = join(input.hooks, `${name}.remorseless-legacy-backup`)
    assert.equal(await fs.readFile(path, "utf8"), before[index])
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600)
  }
  assert.equal(
    (await installGitHooks({ ...input.options, migrateLegacy: true })).changed,
    0
  )
})

for (const kind of [
  "custom",
  "edited-legacy",
  "directory",
  "symlink",
  "hardlink",
  "oversized",
])
  test(`refuses ${kind} target without changing its peer`, async (context) => {
    const input = await fixture(context)
    const target = join(input.hooks, "pre-push")
    if (kind === "directory") await fs.mkdir(target)
    else if (kind === "symlink")
      await fs.symlink(join(input.root, "package.json"), target)
    else if (kind === "hardlink")
      await fs.link(join(input.root, "package.json"), target)
    else
      await fs.writeFile(
        target,
        kind === "edited-legacy"
          ? legacy("pre-push", input.root) + "# custom\n"
          : kind === "oversized"
            ? "x".repeat(16_385)
            : "#!/bin/sh\nexit 0\n"
      )
    await assert.rejects(
      installGitHooks({ ...input.options, migrateLegacy: true })
    )
    await missing(join(input.hooks, "pre-commit"))
  })

test("refuses custom hooksPath even if it points at the default directory", async (context) => {
  const input = await fixture(context)
  assert.equal(input.git(["config", "core.hooksPath", input.hooks]).status, 0)
  const before = await fs.readFile(join(input.root, ".git", "config"))
  await assert.rejects(installGitHooks(input.options), /core.hooksPath/u)
  await missing(join(input.hooks, "pre-commit"))
  assert.deepEqual(
    await fs.readFile(join(input.root, ".git", "config")),
    before
  )
})

test("refuses an actual FIFO hook promptly without opening a blocking reader", async (context) => {
  const input = await fixture(context)
  const result = spawnSync("mkfifo", [join(input.hooks, "pre-push")], {
    env: input.environment,
    timeout: 5_000,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  const installation = input.cli("install-git-hooks.mjs", [], {
    timeout: 2_000,
    killSignal: "SIGKILL",
  })
  assert.equal(installation.error, undefined)
  assert.equal(installation.status, 1)
  assert.match(installation.stderr, /bounded regular/u)
  await missing(join(input.hooks, "pre-commit"))
  assert.ok((await fs.lstat(join(input.hooks, "pre-push"))).isFIFO())
})

test("refuses changed inode or a growing file during a bounded snapshot read", async (context) => {
  for (const mode of ["replaced", "grown"]) {
    const input = await fixture(context)
    const target = join(input.root, "githooks", "pre-commit")
    const io = {
      ...fs,
      open: async (...args) => {
        if (args[0] === target) {
          if (mode === "replaced") {
            await fs.rename(target, `${target}.original`)
            await fs.copyFile(`${target}.original`, target)
          }
          const handle = await fs.open(...args)
          if (mode === "grown") {
            const originalStat = handle.stat.bind(handle)
            let calls = 0
            handle.stat = async () => {
              const metadata = await originalStat()
              if (++calls === 1) await fs.appendFile(target, "x".repeat(20_000))
              return metadata
            }
          }
          return handle
        }
        return fs.open(...args)
      },
    }
    await assert.rejects(
      installGitHooks({ ...input.options, io }),
      /changed|read limit/u
    )
    await missing(join(input.hooks, "pre-commit"))
  }
})

for (const field of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
])
  test(`refuses ${field} routing override`, async (context) => {
    const input = await fixture(context)
    await assert.rejects(
      installGitHooks({
        ...input.options,
        environment: { ...input.environment, [field]: "elsewhere" },
      }),
      /routing/u
    )
  })

test("refuses missing Git, non-repository, wrong manifest and invalid migration option", async (context) => {
  const input = await fixture(context)
  await assert.rejects(
    installGitHooks({
      ...input.options,
      environment: { ...input.environment, PATH: join(input.root, "bin") },
    }),
    /discovery/u
  )
  await assert.rejects(
    installGitHooks({ ...input.options, root: join(input.root, "nested") }),
    /root/u
  )
  await fs.writeFile(join(input.root, "package.json"), '{"name":"other"}')
  await assert.rejects(installGitHooks(input.options), /identity/u)
  await assert.rejects(
    installGitHooks({ ...input.options, migrateLegacy: "yes" }),
    /option/u
  )
})

test("refuses linked worktree without writing its shared hooks", async (context) => {
  const input = await fixture(context)
  assert.equal(
    input.git([
      "commit",
      "--allow-empty",
      "-m",
      "test: seed fixture",
      "-m",
      "- Seed the isolated fixture.",
    ]).status,
    0
  )
  const linked = join(input.root, "linked")
  assert.equal(input.git(["worktree", "add", "--detach", linked]).status, 0)
  await assert.rejects(
    installGitHooks({ ...input.options, root: linked }),
    /external Git/u
  )
  await missing(join(input.hooks, "pre-commit"))
})

for (const target of ["githooks", ".git/hooks"])
  test(`refuses symbolic-link ${target} directory`, async (context) => {
    const input = await fixture(context)
    const path = join(input.root, target)
    const saved = join(input.root, "saved")
    await fs.rename(path, saved)
    await fs.symlink(saved, path)
    await assert.rejects(installGitHooks(input.options), /symbolic links/u)
  })

for (const kind of [
  "missing-source",
  "edited-source",
  "missing-dispatcher",
  "backup-custom",
  "backup-symlink",
])
  test(`refuses ${kind} before activation`, async (context) => {
    const input = await fixture(context)
    if (kind.startsWith("backup")) {
      await input.addLegacy()
      const target = join(input.hooks, "pre-commit.remorseless-legacy-backup")
      if (kind === "backup-symlink")
        await fs.symlink(join(input.root, "package.json"), target)
      else await fs.writeFile(target, "user backup")
    } else if (kind === "missing-source")
      await fs.unlink(join(input.root, "githooks", "pre-commit"))
    else if (kind === "edited-source")
      await fs.appendFile(
        join(input.root, "githooks", "pre-commit"),
        "exit 0\n"
      )
    else await fs.unlink(join(input.root, "scripts", "run-git-hook.mjs"))
    await assert.rejects(
      installGitHooks({ ...input.options, migrateLegacy: true })
    )
    if (!kind.startsWith("backup"))
      await missing(join(input.hooks, "pre-commit"))
  })

for (const previous of ["absent", "legacy"])
  test(`second activation failure restores ${previous} first target and allows retry`, async (context) => {
    const input = await fixture(context)
    if (previous === "legacy") await input.addLegacy()
    let calls = 0
    const io = {
      ...fs,
      rename: async (...args) => {
        if (++calls === 2) throw new Error("injected activation failure")
        return fs.rename(...args)
      },
    }
    await assert.rejects(
      installGitHooks({ ...input.options, migrateLegacy: true, io }),
      /injected/u
    )
    for (const name of ["pre-commit", "pre-push"]) {
      if (previous === "legacy")
        assert.equal(
          await fs.readFile(join(input.hooks, name), "utf8"),
          legacy(name, input.root)
        )
      else await missing(join(input.hooks, name))
    }
    assert.equal(
      (await fs.readdir(input.hooks)).some((name) =>
        name.startsWith(".remorseless-")
      ),
      false
    )
    const retry = await installGitHooks({
      ...input.options,
      migrateLegacy: true,
    })
    assert.equal(retry.changed, 2)
    assert.equal(retry.backups, 0)
  })

test("concurrent target edits are refused and not overwritten by rollback", async (context) => {
  const input = await fixture(context)
  let calls = 0
  const io = {
    ...fs,
    rename: async (...args) => {
      if (++calls === 2) {
        await fs.writeFile(join(input.hooks, "pre-commit"), "concurrent owner")
        throw new Error("second activation failed")
      }
      return fs.rename(...args)
    },
  }
  await assert.rejects(
    installGitHooks({ ...input.options, io }),
    /prevented recovery/u
  )
  assert.equal(
    await fs.readFile(join(input.hooks, "pre-commit"), "utf8"),
    "concurrent owner"
  )
})

test("an observed target change during staging aborts before activation", async (context) => {
  const input = await fixture(context)
  let calls = 0
  const io = {
    ...fs,
    open: async (...args) => {
      if (String(args[0]).includes(".remorseless-pre-push-") && ++calls === 1)
        await fs.writeFile(join(input.hooks, "pre-commit"), "new custom hook")
      return fs.open(...args)
    },
  }
  await assert.rejects(
    installGitHooks({ ...input.options, io }),
    /changed during/u
  )
  assert.equal(
    await fs.readFile(join(input.hooks, "pre-commit"), "utf8"),
    "new custom hook"
  )
  await missing(join(input.hooks, "pre-push"))
})

test("installer CLI help, strict errors, skip and successful installation", async (context) => {
  const input = await fixture(context)
  assert.equal(input.cli("install-git-hooks.mjs", ["--help"]).status, 0)
  assert.equal(input.cli("install-git-hooks.mjs", ["--force"]).status, 1)
  assert.equal(
    input.cli("install-git-hooks.mjs", [], {
      env: { ...input.environment, CI: "true" },
    }).status,
    0
  )
  await missing(join(input.hooks, "pre-commit"))
  assert.equal(input.cli("install-git-hooks.mjs").status, 0)
})

test("hook settings override inherited upper/lower spellings immutably", () => {
  const original = Object.freeze({
    pnpm_config_pm_on_fail: "download",
    PNPM_CONFIG_PM_ON_FAIL: "ignore",
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "install",
    OTHER: "kept",
  })
  const result = hookEnvironment(original)
  assert.equal(result.pnpm_config_pm_on_fail, "error")
  assert.equal(result.pnpm_config_verify_deps_before_run, "error")
  assert.equal(result.PNPM_CONFIG_PM_ON_FAIL, undefined)
  assert.equal(result.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN, undefined)
  assert.equal(result.COREPACK_ENABLE_NETWORK, "0")
  assert.equal(result.OTHER, "kept")
  assert.equal(original.pnpm_config_pm_on_fail, "download")
})

for (const hook of ["pre-commit", "pre-push"])
  test(`${hook} executes exact gates in order without a global Lefthook fallback`, async (context) => {
    const input = await fixture(context)
    input.environment.LEFTHOOK = "0"
    input.environment.LEFTHOOK_BIN = join(input.root, "bin", "lefthook")
    const result = await runGitHook({ ...input.options, hook })
    assert.ok(Object.isFrozen(result))
    const expected = [
      ["--version"],
      ["run", "qa:lint"],
      ...(hook === "pre-push" ? [["run", "qa:storefront:coverage"]] : []),
    ]
    assert.deepEqual(
      (await input.events()).map((event) => event.args),
      expected
    )
    assert.ok(
      (await input.events()).every(
        (event) =>
          event.cwd === input.root &&
          event.pm === "error" &&
          event.deps === "error" &&
          event.corepack === "0"
      )
    )
    await missing(join(input.root, "forbidden-lefthook"))
  })

for (const version of ["12.3.4", "11.17.0\nextra", "", "11.17.0-beta.1"])
  test(`rejects mismatched/malformed pnpm identity ${JSON.stringify(version)}`, async (context) => {
    const input = await fixture(context)
    await assert.rejects(
      runGitHook({
        ...input.options,
        hook: "pre-push",
        environment: { ...input.environment, RR_HOOK_FIXTURE_VERSION: version },
      }),
      /require pnpm/u
    )
    assert.equal((await input.events()).length, 1)
  })

for (const mode of [
  "version-failure",
  "version-huge",
  "version-stderr-huge",
  "version-hang",
  "qa-failure",
  "qa-hang",
  "coverage-failure",
])
  test(`fails closed for ${mode}`, async (context) => {
    const input = await fixture(context)
    await assert.rejects(
      runGitHook({
        ...input.options,
        hook: "pre-push",
        versionTimeoutMs: 100,
        timeoutMs: 100,
        environment: { ...input.environment, RR_HOOK_FIXTURE_MODE: mode },
      })
    )
    const events = await input.events()
    if (mode !== "coverage-failure")
      assert.equal(
        events.some((event) => event.args[1] === "qa:storefront:coverage"),
        false
      )
  })

test("missing pnpm cannot trigger any fallback", async (context) => {
  const input = await fixture(context)
  await fs.unlink(join(input.root, "bin", "pnpm"))
  await assert.rejects(
    runGitHook({ ...input.options, hook: "pre-commit" }),
    /Cannot verify pnpm 11\.17\.0; put that exact version on PATH/u
  )
  assert.deepEqual(await input.events(), [])
})

test("rejects invalid hook, deadlines, manager and repository identity before commands", async (context) => {
  const input = await fixture(context)
  for (const options of [
    { hook: "other" },
    { hook: "pre-commit", timeoutMs: 0 },
    { hook: "pre-commit", versionTimeoutMs: 6000 },
    { hook: "pre-commit", timeoutMs: Number.NaN },
  ])
    await assert.rejects(runGitHook({ ...input.options, ...options }))
  for (const manifest of [
    { name: "other", packageManager: "pnpm@11.17.0" },
    { name: "remorseless-records", packageManager: "pnpm@^11" },
    { name: "remorseless-records" },
  ]) {
    await fs.writeFile(
      join(input.root, "package.json"),
      JSON.stringify(manifest)
    )
    await assert.rejects(
      runGitHook({ ...input.options, hook: "pre-commit" }),
      /exact pnpm/u
    )
  }
  assert.deepEqual(await input.events(), [])
})

test("pre-aborted hook does not start a manager", async (context) => {
  const input = await fixture(context)
  await assert.rejects(
    runGitHook({
      ...input.options,
      hook: "pre-commit",
      signal: AbortSignal.abort(),
    }),
    /cancelled/u
  )
  assert.deepEqual(await input.events(), [])
})

test("abort terminates a running QA child and no later gate starts", async (context) => {
  const input = await fixture(context)
  const controller = new AbortController()
  const running = runGitHook({
    ...input.options,
    hook: "pre-push",
    signal: controller.signal,
    environment: { ...input.environment, RR_HOOK_FIXTURE_MODE: "qa-hang" },
  })
  const rejected = assert.rejects(running, /cancelled/u)
  for (let attempts = 0; ; attempts++) {
    try {
      await fs.access(join(input.root, "child-ready"))
      break
    } catch {
      assert.ok(attempts < 200)
      await delay(10)
    }
  }
  const pid = Number(await fs.readFile(join(input.root, "child-ready"), "utf8"))
  controller.abort()
  await rejected
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  assert.equal((await input.events()).length, 2)
})

test("real Git invokes installed hook from a subdirectory and prevents failed commits", async (context) => {
  const input = await fixture(context)
  await installGitHooks(input.options)
  const args = [
    "commit",
    "--allow-empty",
    "-m",
    "test: run hook fixture",
    "-m",
    "- Exercise only the isolated fixture.",
  ]
  const failed = input.git(args, {
    cwd: join(input.root, "nested"),
    env: { ...input.environment, RR_HOOK_FIXTURE_MODE: "qa-failure" },
  })
  assert.notEqual(failed.status, 0)
  assert.notEqual(input.git(["rev-parse", "--verify", "HEAD"]).status, 0)
  assert.equal(input.git(args, { cwd: join(input.root, "nested") }).status, 0)
  assert.equal(input.git(["rev-parse", "--verify", "HEAD"]).status, 0)
})

test("real Git pre-push preserves order and prevents coverage failure from updating a local remote", async (context) => {
  const input = await fixture(context)
  await installGitHooks(input.options)
  assert.equal(
    input.git([
      "commit",
      "--allow-empty",
      "-m",
      "test: seed push fixture",
      "-m",
      "- Seed the isolated fixture.",
    ]).status,
    0
  )
  const remote = join(input.root, "local-remote.git")
  assert.equal(input.git(["init", "--bare", "--quiet", remote]).status, 0)
  const failed = input.git(["push", remote, "HEAD:refs/heads/fixture"], {
    cwd: join(input.root, "nested"),
    env: { ...input.environment, RR_HOOK_FIXTURE_MODE: "coverage-failure" },
  })
  assert.notEqual(failed.status, 0)
  assert.notEqual(
    input.git([
      "--git-dir",
      remote,
      "rev-parse",
      "--verify",
      "refs/heads/fixture",
    ]).status,
    0
  )
  assert.equal(input.git(["push", remote, "HEAD:refs/heads/fixture"]).status, 0)
  assert.equal(
    input.git([
      "--git-dir",
      remote,
      "rev-parse",
      "--verify",
      "refs/heads/fixture",
    ]).stdout,
    input.git(["rev-parse", "HEAD"]).stdout
  )
})

test("dispatcher CLI rejects extra/unknown arguments and supports successful invocation", async (context) => {
  const input = await fixture(context)
  assert.equal(input.cli("run-git-hook.mjs").status, 1)
  assert.equal(input.cli("run-git-hook.mjs", ["pre-commit", "extra"]).status, 1)
  assert.equal(input.cli("run-git-hook.mjs", ["other"]).status, 1)
  assert.equal(input.cli("run-git-hook.mjs", ["pre-commit"]).status, 0)
})

for (const signal of ["SIGINT", "SIGTERM"])
  test(`dispatcher forwards ${signal} cancellation to its child`, async (context) => {
    const input = await fixture(context)
    const child = spawn(
      process.execPath,
      [join(input.root, "scripts", "run-git-hook.mjs"), "pre-push"],
      {
        cwd: input.root,
        env: { ...input.environment, RR_HOOK_FIXTURE_MODE: "qa-hang" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    context.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL")
    })
    const closed = new Promise((resolvePromise) =>
      child.once("close", (code) => resolvePromise(code))
    )
    child.stdout.resume()
    child.stderr.resume()
    for (let attempts = 0; ; attempts++) {
      try {
        await fs.access(join(input.root, "child-ready"))
        break
      } catch {
        assert.ok(attempts < 200)
        await delay(10)
      }
    }
    const pid = Number(
      await fs.readFile(join(input.root, "child-ready"), "utf8")
    )
    child.kill(signal)
    assert.equal(await closed, 1)
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  })
