/**
 * Phase 5 credentials: `creds:init` makes the key pair, `creds:edit`
 * round-trips through `$EDITOR`, `show`, `fetch` and `diff` decrypt, and
 * `sync` checks the Vercel link before it runs anything.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ArgsDef, CommandDef } from "citty"
import { runCommand } from "citty"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  credsDiff,
  credsEdit,
  credsFetch,
  credsInit,
  credsShow,
  credsSync,
} from "../src/commands/creds.js"

const fixtures = join(import.meta.dirname, "..", "fixtures")

let app: string
let originalCwd: string
let stdout: string[]
let stderr: string[]
let restore: Array<() => void> = []
const savedEnv: Record<string, string | undefined> = {}

const capture = (stream: NodeJS.WriteStream, sink: string[]): (() => void) => {
  const original = stream.write.bind(stream)
  stream.write = ((chunk: string | Uint8Array) => {
    sink.push(String(chunk))
    return true
  }) as typeof stream.write
  return () => {
    stream.write = original
  }
}

const setEnv = (name: string, value: string | undefined): void => {
  if (!(name in savedEnv)) {
    savedEnv[name] = process.env[name]
  }
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), "wee-creds-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  originalCwd = process.cwd()
  process.chdir(app)
  stdout = []
  stderr = []
  restore = [capture(process.stdout, stdout), capture(process.stderr, stderr)]
  process.exitCode = undefined
  setEnv("VISUAL", undefined)
  setEnv("EDITOR", undefined)
  setEnv("WEE_CREDENTIALS_KEY", undefined)
  setEnv("APP_ENV", undefined)
})

afterEach(() => {
  for (const fn of restore) {
    fn()
  }
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
  process.chdir(originalCwd)
  rmSync(app, { recursive: true, force: true })
  process.exitCode = undefined
})

interface Result {
  out: string
  err: string
  exit: number
}

const run = async <T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[]
): Promise<Result> => {
  stdout.length = 0
  stderr.length = 0
  process.exitCode = undefined
  await runCommand(command, { rawArgs: [...rawArgs, "--json"] })
  return {
    out: stdout.join(""),
    err: stderr.join(""),
    exit: process.exitCode === undefined ? 0 : Number(process.exitCode),
  }
}

const has = (path: string): boolean => existsSync(join(app, path))
const read = (path: string): string => readFileSync(join(app, path), "utf8")

/** An `$EDITOR` that appends `line` to the file it is given. */
const fakeEditor = (line: string): string => {
  const script = join(app, "editor.mjs")
  writeFileSync(
    script,
    `import { appendFileSync } from "node:fs"\nappendFileSync(process.argv[2], ${JSON.stringify(`${line}\n`)})\n`
  )
  chmodSync(script, 0o700)
  return `node ${script}`
}

const init = async (): Promise<Result> => run(credsInit, [])

describe("creds:init", () => {
  it("writes the key pair, the gitignore line and the first file", async () => {
    const { out, exit, err } = await init()
    expect(err).toBe("")
    expect(exit).toBe(0)
    expect(JSON.parse(out)).toEqual([
      { action: "create", path: "config/credentials/.age-recipients" },
      { action: "create", path: "config/credentials/.age-identity" },
      { action: "inject", path: ".gitignore" },
      { action: "create", path: "config/credentials/local.env.enc" },
    ])
    expect(read("config/credentials/.age-recipients")).toMatch(/^age1/)
    expect(read("config/credentials/.age-identity")).toMatch(
      /^AGE-SECRET-KEY-1/
    )
    expect(read(".gitignore")).toContain("config/credentials/.age-identity\n")
    expect(has("config/credentials/local.env.enc")).toBe(true)
  })

  it("refuses a second run without --force", async () => {
    await init()
    const { exit, err } = await init()
    expect(exit).toBe(1)
    expect(err).toContain("credentials-exist")
    const forced = await run(credsInit, ["--force"])
    expect(forced.exit).toBe(0)
    expect(read(".gitignore").match(/\.age-identity/g)).toHaveLength(1)
  })

  it("writes nothing under --dry-run", async () => {
    const { exit } = await run(credsInit, ["--dry-run"])
    expect(exit).toBe(0)
    expect(has("config/credentials")).toBe(false)
    expect(has(".gitignore")).toBe(false)
  })
})

describe("creds:edit, show, fetch", () => {
  it("edit re-encrypts what the editor wrote and show reads it back", async () => {
    await init()
    const before = readFileSync(join(app, "config/credentials/local.env.enc"))
    setEnv("EDITOR", fakeEditor("API_KEY=secret"))
    const edit = await run(credsEdit, [])
    expect(edit.err).toBe("")
    expect(JSON.parse(edit.out)).toEqual({
      action: "edit",
      path: "config/credentials/local.env.enc",
    })
    const after = readFileSync(join(app, "config/credentials/local.env.enc"))
    expect(after.equals(before)).toBe(false)
    expect(after.toString("utf8")).not.toContain("secret")

    const show = await run(credsShow, [])
    expect(JSON.parse(show.out)).toEqual({ API_KEY: "secret" })

    const fetched = await run(credsFetch, ["API_KEY"])
    expect(JSON.parse(fetched.out)).toEqual({
      key: "API_KEY",
      value: "secret",
    })
  })

  it("edit creates a file for a new environment and reports unchanged edits", async () => {
    await init()
    setEnv("EDITOR", fakeEditor("TOKEN=abc"))
    const first = await run(credsEdit, ["--env=preview"])
    expect(JSON.parse(first.out)).toEqual({
      action: "edit",
      path: "config/credentials/preview.env.enc",
    })
    writeFileSync(join(app, "editor.mjs"), "process.exit(0)\n")
    const second = await run(credsEdit, ["--env=preview"])
    expect(JSON.parse(second.out)).toEqual({
      action: "unchanged",
      path: "config/credentials/preview.env.enc",
    })
    const show = await run(credsShow, ["--env=preview"])
    expect(JSON.parse(show.out)).toEqual({ TOKEN: "abc" })
  })

  it("edit fails without an editor when stdin is not a terminal", async () => {
    await init()
    const { exit, err } = await run(credsEdit, [])
    expect(exit).toBe(1)
    expect(err).toContain("editor-missing")
  })

  it("fetch of a missing key exits 1 and show of a missing env names the fix", async () => {
    await init()
    const missing = await run(credsFetch, ["NOPE"])
    expect(missing.exit).toBe(1)
    expect(missing.err).toContain("credential-missing")
    const noEnv = await run(credsShow, ["--env=production"])
    expect(noEnv.exit).toBe(1)
    expect(noEnv.err).toContain("credentials-missing")
    expect(noEnv.err).toContain("wee creds:edit --env=production")
  })

  it("WEE_CREDENTIALS_KEY replaces the identity file", async () => {
    await init()
    setEnv("EDITOR", fakeEditor("API_KEY=from-env"))
    await run(credsEdit, [])
    const identity = read("config/credentials/.age-identity").trim()
    rmSync(join(app, "config/credentials/.age-identity"))

    const withoutKey = await run(credsShow, [])
    expect(withoutKey.exit).toBe(1)
    expect(withoutKey.err).toContain("credentials-key-missing")

    setEnv("WEE_CREDENTIALS_KEY", identity)
    const withKey = await run(credsShow, [])
    expect(JSON.parse(withKey.out)).toEqual({ API_KEY: "from-env" })
  })
})

describe("creds:diff", () => {
  it("prints the plaintext of a ciphertext path", async () => {
    await init()
    setEnv("EDITOR", fakeEditor("API_KEY=plain"))
    await run(credsEdit, [])
    const { out, exit } = await run(credsDiff, [
      "config/credentials/local.env.enc",
    ])
    expect(exit).toBe(0)
    expect(out).toContain("# Credentials for local.")
    expect(out).toContain("API_KEY=plain\n")
  })

  it("needs a path or --enroll", async () => {
    await init()
    const { exit, err } = await run(credsDiff, [])
    expect(exit).toBe(1)
    expect(err).toContain('"usage"')
  })

  it("--enroll writes .gitattributes under --dry-run", async () => {
    await init()
    const { out, exit } = await run(credsDiff, ["--enroll", "--dry-run"])
    expect(exit).toBe(0)
    const rows = JSON.parse(out) as { action: string; path: string }[]
    expect(rows[0]).toEqual({ action: "inject", path: ".gitattributes" })
    expect(rows[1]?.path).toBe(
      "diff.wee_credentials.textconv=npx wee creds:diff"
    )
    expect(has(".gitattributes")).toBe(false)
  })
})

describe("creds:sync", () => {
  it("rejects unknown targets and environments", async () => {
    await init()
    const target = await run(credsSync, ["--target=netlify"])
    expect(target.err).toContain("invalid-target")
    const env = await run(credsSync, ["--env=staging"])
    expect(env.err).toContain("invalid-env")
  })

  it("fails when the app is not linked to Vercel", async () => {
    await init()
    const { exit, err } = await run(credsSync, [])
    expect(exit).toBe(1)
    expect(err).toContain("vercel-not-linked")
  })

  it("lists the keys and the Vercel environment under --dry-run", async () => {
    await init()
    setEnv("EDITOR", fakeEditor("API_KEY=x"))
    await run(credsEdit, ["--env=production"])
    mkdirSync(join(app, ".vercel"))
    writeFileSync(
      join(app, ".vercel", "project.json"),
      '{"projectId":"p","orgId":"o"}\n',
      { flag: "w" }
    )
    const { out, exit } = await run(credsSync, [
      "--env=production",
      "--dry-run",
    ])
    expect(exit).toBe(0)
    expect(JSON.parse(out)).toEqual([
      { action: "sync", path: "API_KEY", environment: "production" },
    ])
  })
})
