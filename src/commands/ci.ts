/**
 * `wee ci`: runs the steps from `config/ci.ts` in order and stops at the
 * first failure. Built-in steps reuse the lint, typecheck, test, test:e2e
 * and build runners; custom steps run a shell command in the app. One
 * summary line per step; the same runner serves locally and in GitHub
 * Actions.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { x } from "tinyexec"
import { z } from "zod"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { assertAppRouter } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import type { Row } from "../core/output.js"
import { runScript } from "../lib/packages.js"
import { runtimeScript } from "../lib/runtime.js"
import type { Stdio, TaskResult } from "../lib/tasks.js"
import { build, lint, test, testE2e, typecheck } from "../lib/tasks.js"
import type { BuiltInStep } from "../templates/ops.js"
import { CI_STEPS } from "../templates/ops.js"

const CI_CONFIG = join("config", "ci.ts")

const stepSchema = z.union([
  z.string(),
  z.object({ name: z.string(), command: z.string() }),
])
const stepsSchema = z.array(stepSchema)

type CiStep = z.output<typeof stepSchema>

/**
 * Steps from `config/ci.ts`, read through tsx or bun inside the app. With
 * no config file: the five built-in steps, minus `test:e2e` when the app
 * has no `e2e/` folder.
 */
const loadSteps = async (ctx: Context): Promise<CiStep[]> => {
  const file = join(ctx.target.path, CI_CONFIG)
  if (!existsSync(file)) {
    const hasE2e = existsSync(join(ctx.target.path, "e2e"))
    return CI_STEPS.filter((step) => hasE2e || step !== "test:e2e")
  }
  const result = await runScript({
    ctx,
    script: runtimeScript("ci-config"),
    args: [file],
    stdio: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new WeeError("ci-config-invalid", `Cannot load ${CI_CONFIG}`, {
      data: { stderr: result.stderr },
    })
  }
  const parsed = stepsSchema.safeParse(JSON.parse(result.stdout))
  if (!parsed.success) {
    throw new WeeError(
      "ci-config-invalid",
      `${CI_CONFIG} must export "steps": strings or { name, command } objects`
    )
  }
  return parsed.data
}

const isBuiltIn = (name: string): name is BuiltInStep =>
  (CI_STEPS as readonly string[]).includes(name)

const runBuiltIn = (
  ctx: Context,
  step: BuiltInStep,
  stdio: Stdio
): Promise<TaskResult> => {
  switch (step) {
    case "lint":
      return lint({ ctx, stdio })
    case "typecheck":
      return typecheck({ ctx, stdio })
    case "test":
      return test({ ctx, stdio, watch: false })
    case "test:e2e":
      return testE2e({ ctx, stdio, headed: false })
    case "build":
      return build({ ctx, stdio })
  }
}

const runCustom = async (
  ctx: Context,
  command: string,
  stdio: Stdio
): Promise<TaskResult> => {
  const result = await x("sh", ["-c", command], {
    nodeOptions: { cwd: ctx.target.path, stdio },
    throwOnError: false,
  })
  return {
    exitCode: result.exitCode ?? 1,
    output: `${result.stdout}${result.stderr}`,
  }
}

const runStep = (
  ctx: Context,
  step: CiStep,
  stdio: Stdio
): Promise<TaskResult> => {
  if (typeof step !== "string") {
    return runCustom(ctx, step.command, stdio)
  }
  if (!isBuiltIn(step)) {
    throw new WeeError(
      "ci-step-unknown",
      `Unknown step "${step}". Built-in steps: ${CI_STEPS.join(", ")}.`
    )
  }
  return runBuiltIn(ctx, step, stdio)
}

const stepName = (step: CiStep): string =>
  typeof step === "string" ? step : step.name

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

const ci = defineWeeCommand({
  meta: {
    name: "ci",
    description: "Run the steps in config/ci.ts, stop at the first failure",
  },
  run: async (ctx) => {
    assertAppRouter(ctx)
    const steps = await loadSteps(ctx)
    const stdio: Stdio = ctx.flags.json ? "pipe" : "inherit"
    const rows: Row[] = []
    for (const step of steps) {
      const name = stepName(step)
      const started = performance.now()
      const result = await runStep(ctx, step, stdio)
      const duration = seconds(performance.now() - started)
      const status = result.exitCode === 0 ? "ok" : "failed"
      rows.push({ step: name, status, duration })
      if (!ctx.flags.json) {
        process.stdout.write(
          `${status === "ok" ? "✓" : "✗"} ${name} ${duration}\n`
        )
      }
      if (result.exitCode !== 0) {
        throw new WeeError("ci-failed", `${name} failed`, {
          exitCode: result.exitCode,
          data: {
            steps: rows,
            ...(ctx.flags.json ? { output: result.output } : {}),
          },
        })
      }
    }
    return ctx.flags.json ? { data: rows } : undefined
  },
})

export { CI_CONFIG, ci, loadSteps }
