/**
 * Phase 6 acceptance: `g generator Widget` scaffolds a custom generator
 * that the CLI discovers under `tools/generators/`; it runs with
 * `--dry-run`, `--json` and `destroy` without CLI changes and its output
 * typechecks against the public types. `g task` scaffolds a task that runs
 * as `wee <name>` with the app context preloaded.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ArgsDef, CommandDef } from "citty"
import { runCommand } from "citty"
import { x } from "tinyexec"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { stripGlobalFlags } from "../src/commands/custom.js"
import { destroy } from "../src/commands/destroy.js"
import { generator } from "../src/commands/g/generator.js"
import { g } from "../src/commands/g/index.js"
import { task } from "../src/commands/g/task.js"

const root = join(import.meta.dirname, "..")
const fixtures = join(root, "fixtures")

let app: string
let originalCwd: string
let stdout: string[] = []
let stderr: string[] = []

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

interface Result {
  out: string
  err: string
  exit: number
}

const run = async <T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[]
): Promise<Result> => {
  stdout = []
  stderr = []
  const restore = [
    capture(process.stdout, stdout),
    capture(process.stderr, stderr),
  ]
  process.exitCode = undefined
  try {
    await runCommand(command, { rawArgs: [...rawArgs, "--json"] })
  } finally {
    for (const fn of restore) {
      fn()
    }
  }
  const result = {
    out: stdout.join(""),
    err: stderr.join(""),
    exit: process.exitCode === undefined ? 0 : Number(process.exitCode),
  }
  process.exitCode = undefined
  return result
}

const ok = async <T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[]
): Promise<Result> => {
  const result = await run(command, rawArgs)
  expect(result.err).toBe("")
  expect(result.exit).toBe(0)
  return result
}

interface Row {
  action: string
  path: string
}

const rows = (out: string): Row[] => JSON.parse(out) as Row[]

const read = (path: string): string => readFileSync(join(app, path), "utf8")
const has = (path: string): boolean => existsSync(join(app, path))

const TSCONFIG = {
  compilerOptions: {
    target: "es2022",
    lib: ["dom", "dom.iterable", "esnext"],
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
    esModuleInterop: true,
    noUncheckedIndexedAccess: true,
    types: ["node"],
    // The package is unpublished; point its types at the source.
    paths: { "next-wee": [join(root, "src", "index.ts")] },
  },
  include: ["src", "tools"],
}

const enterApp = (): void => {
  app = mkdtempSync(join(tmpdir(), "wee-ext-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"))
  writeFileSync(
    join(app, "tsconfig.json"),
    `${JSON.stringify(TSCONFIG, null, 2)}\n`
  )
  originalCwd = process.cwd()
  process.chdir(app)
}

const leaveApp = (): void => {
  process.chdir(originalCwd)
  rmSync(app, { recursive: true, force: true })
}

interface Exec {
  output: string
  exitCode: number | undefined
}

const exec = async (args: string[]): Promise<Exec> => {
  const result = await x("node", args, {
    nodeOptions: { cwd: app },
    throwOnError: false,
  })
  return {
    output: `${result.stdout}${result.stderr}`,
    exitCode: result.exitCode,
  }
}

/** The CLI as a child process, where discovery reads `process.argv`. */
const cli = (args: string[]): Promise<Exec> =>
  exec(["--import", "tsx", join(root, "src/cli.ts"), ...args])

describe("phase 6 extensibility", () => {
  beforeAll(enterApp)
  afterAll(leaveApp)

  it("g generator refuses a built-in name", async () => {
    const { exit, err } = await run(generator, ["page"])
    expect(exit).toBe(1)
    expect(err).toContain("generator-reserved")
  })

  it("g generator Widget scaffolds tools/generators/widget", async () => {
    const { out } = await ok(generator, ["Widget"])
    expect(rows(out).map((row) => row.path)).toContain(
      "tools/generators/widget/index.ts"
    )
    expect(has("tools/generators/widget/templates/widget.ts.tpl")).toBe(true)
    expect(has(".app/manifests/generator-widget.json")).toBe(true)
    expect(read("tools/generators/widget/index.ts")).toContain(
      'import type { GeneratorDef } from "next-wee"'
    )
  })

  it("the custom generator gets --dry-run and --json without CLI changes", async () => {
    const { out } = await ok(await g(), ["widget", "OrderTotal", "--dry-run"])
    const paths = rows(out).map((row) => row.path)
    expect(paths).toContain("src/widgets/order-total.ts")
    expect(has("src/widgets/order-total.ts")).toBe(false)
    expect(has(".app/manifests/widget-order-total.json")).toBe(false)
  }, 30_000)

  it("the custom generator writes its file and manifest", async () => {
    const { out } = await ok(await g(), ["widget", "OrderTotal"])
    expect(rows(out).map((row) => row.action)).toContain("manifest")
    expect(read("src/widgets/order-total.ts")).toContain("const orderTotal = {")
    expect(read("src/widgets/order-total.ts")).toContain('name: "OrderTotal"')
    const manifest = JSON.parse(
      read(".app/manifests/widget-order-total.json")
    ) as {
      generator: string
      args: Record<string, unknown>
    }
    expect(manifest.generator).toBe("widget")
    expect(manifest.args.positional).toEqual(["OrderTotal"])
    const again = await run(await g(), ["widget", "OrderTotal"])
    expect(again.exit).toBe(1)
    expect(again.err).toContain("file-exists")
  }, 30_000)

  it("the CLI lists and runs the custom generator", async () => {
    const help = await cli(["g", "--help"])
    expect(help.output).toContain("widget")
    expect(help.output).toContain(
      "Custom generator: tools/generators/widget/index.ts"
    )
    const { output, exitCode } = await cli(["g", "widget", "Foo", "--json"])
    expect(exitCode).toBe(0)
    expect(rows(output).map((row) => row.path)).toContain("src/widgets/foo.ts")
    expect(has("src/widgets/foo.ts")).toBe(true)
  }, 30_000)

  it("a generator without the export fails with generator-failed", async () => {
    mkdirSync(join(app, "tools/generators/broken"), { recursive: true })
    writeFileSync(
      join(app, "tools/generators/broken/index.ts"),
      "export const nope = 1\n"
    )
    const { exit, err } = await run(await g(), ["broken", "X"])
    expect(exit).toBe(2)
    expect(err).toContain('must export "generator"')
    expect(err).toContain("generator-failed")
    rmSync(join(app, "tools/generators/broken"), { recursive: true })
  }, 30_000)

  it("g task refuses a built-in name and scaffolds tools/tasks", async () => {
    const bad = await run(task, ["routes"])
    expect(bad.exit).toBe(1)
    expect(bad.err).toContain("task-reserved")
    const { out } = await ok(task, ["reports:nightly"])
    expect(rows(out).map((row) => row.path)).toContain(
      "tools/tasks/reports-nightly.ts"
    )
    expect(has(".app/manifests/task-reports-nightly.json")).toBe(true)
    expect(read("tools/tasks/reports-nightly.ts")).toContain(
      "export { reportsNightly as task }"
    )
  })

  it("everything generated typechecks against the public types", async () => {
    const { output, exitCode } = await exec([
      join(app, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "-p",
      ".",
    ])
    expect(output).toBe("")
    expect(exitCode).toBe(0)
  }, 60_000)

  it("wee <task> runs the task with the app context and its own args", async () => {
    const colon = await cli(["reports:nightly", "--since=1", "--json"])
    expect(colon.exitCode).toBe(0)
    expect(colon.output).toContain(
      "reports:nightly: db off, services none, args --since=1"
    )
    const dashed = await cli(["reports-nightly"])
    expect(dashed.exitCode).toBe(0)
    expect(dashed.output).toContain("args none")
    const help = await cli(["--help"])
    expect(help.output).toContain("Task: tools/tasks/reports-nightly.ts")
  }, 60_000)

  it("a task that returns false exits 1", async () => {
    writeFileSync(
      join(app, "tools/tasks/fail.ts"),
      "export const task = async () => false\n"
    )
    const { exitCode } = await cli(["fail"])
    expect(exitCode).toBe(1)
    rmSync(join(app, "tools/tasks/fail.ts"))
  }, 30_000)

  it("stripGlobalFlags keeps only the task's args", () => {
    expect(
      stripGlobalFlags([
        "--since=1",
        "--json",
        "--app",
        "web",
        "--package=ui",
        "--dry-run",
        "-v",
        "--force",
      ])
    ).toEqual(["--since=1", "-v"])
  })

  it("destroy reverses custom generator runs and the scaffolds", async () => {
    await ok(destroy, ["widget", "OrderTotal"])
    expect(has("src/widgets/order-total.ts")).toBe(false)
    expect(has(".app/manifests/widget-order-total.json")).toBe(false)
    await ok(destroy, ["widget", "Foo"])
    await ok(destroy, ["generator", "widget"])
    expect(has("tools/generators/widget")).toBe(false)
    await ok(destroy, ["task", "reports:nightly"])
    expect(has("tools/tasks/reports-nightly.ts")).toBe(false)
  })
})
