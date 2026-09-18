/**
 * `wee g env NAME[:server|client] ...`: adds validated variables to
 * `env.ts` and placeholders to `.env.example`. Scope defaults from the
 * `NEXT_PUBLIC_` prefix; client variables must carry it. One manifest per
 * run, named after the joined variable names.
 */
import type { FileChange } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { kebabCase } from "../../lib/inflect.js"
import { ENV_ANCHORS, envTemplate } from "../../templates/app.js"
import { assertBlockAbsent, srcPath } from "./paths.js"

type EnvScope = "server" | "client"

interface EnvVar {
  name: string
  scope: EnvScope
}

const NAME = /^[A-Z][A-Z0-9_]*$/
const CLIENT_PREFIX = "NEXT_PUBLIC_"

const parseEnvVar = (raw: string): EnvVar => {
  const [name = "", scope] = raw.split(":")
  if (!NAME.test(name)) {
    throw new WeeError(
      "invalid-env-name",
      `"${raw}": use UPPER_SNAKE_CASE, e.g. STRIPE_KEY or STRIPE_KEY:server`
    )
  }
  const isPublic = name.startsWith(CLIENT_PREFIX)
  if (scope !== undefined && scope !== "server" && scope !== "client") {
    throw new WeeError(
      "invalid-env-scope",
      `"${raw}": scope must be server or client`
    )
  }
  const resolved: EnvScope = scope ?? (isPublic ? "client" : "server")
  if ((resolved === "client") !== isPublic) {
    throw new WeeError(
      "invalid-env-scope",
      `${name}: client variables need the ${CLIENT_PREFIX} prefix and server variables must not have it`
    )
  }
  return { name, scope: resolved }
}

const parseEnvVars = (positional: string[]): EnvVar[] => {
  const vars = positional.map(parseEnvVar)
  const names = new Set(vars.map((variable) => variable.name))
  if (names.size !== vars.length) {
    throw new WeeError("duplicate-env-name", "Each variable once, please")
  }
  return vars
}

const envGenerator = defineGenerator({
  name: "env",
  description: "Validated env variables in env.ts and .env.example",
  args: {
    variable: {
      type: "positional",
      description:
        "NAME[:server|client], e.g. STRIPE_KEY NEXT_PUBLIC_POSTHOG_KEY",
      required: true,
    },
  },
  manifestName: (args) =>
    parseEnvVars(args._)
      .map((variable) => kebabCase(variable.name))
      .join("-"),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const vars = parseEnvVars(args._)
    const envFile = srcPath(ctx, "env.ts")
    const changes: FileChange[] = [
      { kind: "ensure", path: envFile, content: envTemplate() },
    ]
    for (const variable of vars) {
      const marker = `env-${kebabCase(variable.name)}`
      assertBlockAbsent(ctx, envFile, marker)
      changes.push({
        kind: "inject",
        path: envFile,
        marker,
        content: `  ${variable.name}: z.string(),`,
        after: ENV_ANCHORS[variable.scope],
      })
      if (variable.scope === "client") {
        changes.push({
          kind: "inject",
          path: envFile,
          marker: `${marker}-value`,
          content: `  ${variable.name}: process.env.${variable.name},`,
          after: ENV_ANCHORS.clientValues,
        })
      }
      changes.push({
        kind: "inject",
        path: ".env.example",
        marker,
        content: `${variable.name}=`,
      })
    }
    return changes
  },
})

const env = defineWeeCommand({
  meta: { name: "env", description: envGenerator.description },
  args: envGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: envGenerator, args }),
})

export { env, envGenerator, parseEnvVars }
