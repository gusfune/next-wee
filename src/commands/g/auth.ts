/**
 * `wee g auth --provider=placeholder|better-auth`: `lib/auth/index.ts`
 * with `getSession()` and `requireSession()`. Better Auth also gets its
 * four tables through the configured `DbAdapter`, the API route, the
 * client, the providers file and a sign-in page. Manifest name is the
 * provider, so `destroy auth better-auth` reverses it.
 */
import { join } from "node:path"
import type { ParsedArgs } from "citty"
import { getDbAdapter } from "../../adapters/index.js"
import type { FileChange } from "../../core/changes.js"
import type { CommandResult } from "../../core/command.js"
import { defineWeeCommand } from "../../core/command.js"
import type { Context } from "../../core/context.js"
import { assertAppRouter, sourceDir } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import {
  AUTH_ENV,
  AUTH_MODELS,
  authClientTemplate,
  authRouteTemplate,
  betterAuthTemplate,
  placeholderTemplate,
  providersTemplate,
  signInFormTemplate,
  signInFormTestTemplate,
  signInPageTemplate,
} from "../../templates/auth.js"
import { create, relativeImport, srcPath } from "./paths.js"
import {
  configPatch,
  envExampleChanges,
  installRows,
  rowsOf,
  skipInstallArg,
} from "./setup.js"

const PROVIDERS = ["placeholder", "better-auth"] as const
type AuthProvider = (typeof PROVIDERS)[number]

const parseProvider = (raw: string): AuthProvider => {
  const found = PROVIDERS.find((provider) => provider === raw)
  if (found === undefined) {
    throw new WeeError(
      "invalid-auth-provider",
      `--provider must be one of ${PROVIDERS.join(", ")}`
    )
  }
  return found
}

const authIndexPath = (ctx: Context): string =>
  srcPath(ctx, "lib", "auth", "index.ts")

const providersPath = (ctx: Context): string =>
  srcPath(ctx, "lib", "auth", "providers.ts")

/** The four Better Auth tables in one migration, through the configured adapter. */
const authTableChanges = async (ctx: Context): Promise<FileChange[]> => {
  const adapter = getDbAdapter(ctx)
  // One by one: Session and Account reference User, which is pending here.
  const schema: FileChange[] = []
  for (const model of AUTH_MODELS) {
    schema.push(...adapter.emitModel(ctx, model, schema))
  }
  const migration = await adapter.emitMigration(ctx, {
    name: "create_auth_tables",
    change: { kind: "create-tables", models: [...AUTH_MODELS] },
    pending: schema,
  })
  return [...schema, ...migration]
}

const betterAuthChanges = async (ctx: Context): Promise<FileChange[]> => {
  const adapter = getDbAdapter(ctx)
  const db = ctx.config.db
  if (db === undefined) {
    throw new WeeError(
      "db-not-initialised",
      'Better Auth needs a database. Run "wee db:init" first.'
    )
  }
  const index = authIndexPath(ctx)
  const providers = providersPath(ctx)
  const client = srcPath(ctx, "lib", "auth", "client.ts")
  const route = srcPath(ctx, "app", "api", "auth", "[...all]", "route.ts")
  const page = srcPath(ctx, "app", "sign-in", "page.tsx")
  const form = srcPath(ctx, "components", "auth", "sign-in-form.tsx")
  const src = sourceDir(ctx)
  return [
    ...(await authTableChanges(ctx)),
    create(
      ctx,
      index,
      betterAuthTemplate({
        adapter: adapter.name,
        provider: db.provider,
        clientImport: relativeImport(index, join(src, "db", "client.ts")),
        schemaImport: relativeImport(
          index,
          join(src, db.schemaDir, "index.ts")
        ),
      })
    ),
    create(ctx, providers, providersTemplate()),
    create(ctx, client, authClientTemplate()),
    create(ctx, route, authRouteTemplate(relativeImport(route, index))),
    create(
      ctx,
      page,
      signInPageTemplate({
        formImport: relativeImport(page, form),
        providersImport: relativeImport(page, providers),
      })
    ),
    create(
      ctx,
      form,
      signInFormTemplate({
        clientImport: relativeImport(form, client),
        providersImport: relativeImport(form, providers),
      })
    ),
    create(
      ctx,
      srcPath(ctx, "components", "auth", "sign-in-form.test.tsx"),
      signInFormTestTemplate()
    ),
    ...envExampleChanges(ctx, "auth", AUTH_ENV),
  ]
}

const authGenerator = defineGenerator({
  name: "auth",
  description: "Auth module: placeholder or Better Auth with a sign-in page",
  args: {
    provider: {
      type: "string",
      description: "placeholder | better-auth",
      default: "better-auth",
    },
    ...skipInstallArg,
  },
  manifestName: (args) => parseProvider(args.provider),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const provider = parseProvider(args.provider)
    const changes =
      provider === "placeholder"
        ? [create(ctx, authIndexPath(ctx), placeholderTemplate())]
        : await betterAuthChanges(ctx)
    return [...changes, configPatch(ctx, { auth: { provider } })]
  },
})

type AuthArgs = ParsedArgs<typeof authGenerator.args>

/** The `g auth` body, shared with `wee new --auth`. */
const runAuth = async (
  ctx: Context,
  args: AuthArgs
): Promise<CommandResult> => {
  const result = await runGenerator({ ctx, generator: authGenerator, args })
  if (parseProvider(args.provider) === "placeholder") {
    return result
  }
  const extra = await installRows({
    ctx,
    dependencies: ["better-auth"],
    devDependencies: [],
    skipInstall: args["skip-install"],
  })
  return { ...result, data: [...rowsOf(result.data), ...rowsOf(extra)] }
}

const auth = defineWeeCommand({
  meta: { name: "auth", description: authGenerator.description },
  args: authGenerator.args,
  run: runAuth,
})

export { auth, authGenerator, providersPath, runAuth }
