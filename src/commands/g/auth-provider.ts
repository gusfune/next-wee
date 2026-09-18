/**
 * `wee g auth:provider <Name>`: a social provider block in
 * `lib/auth/providers.ts` and its two keys in `.env.example`. The id is the
 * lowercase name (`GitHub` gives `github`); Better Auth's types reject an
 * unknown id at typecheck.
 */
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import {
  PROVIDERS_ANCHOR,
  providerBlock,
  providerEnv,
} from "../../templates/auth.js"
import { providersPath } from "./auth.js"
import { assertBlockAbsent, exists } from "./paths.js"

const providerId = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9]/g, "")

const authProviderGenerator = defineGenerator({
  name: "auth-provider",
  description: "Social sign-in provider for Better Auth",
  args: {
    name: {
      type: "positional",
      description: "Provider name, e.g. GitHub or google",
      required: true,
    },
  },
  manifestName: (args) => providerId(args.name),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const id = providerId(args.name)
    if (id.length === 0) {
      throw new WeeError(
        "invalid-provider-name",
        `"${args.name}" has no letters`
      )
    }
    const file = providersPath(ctx)
    if (ctx.config.auth?.provider !== "better-auth" || !exists(ctx, file)) {
      throw new WeeError(
        "auth-not-initialised",
        'No Better Auth setup. Run "wee g auth --provider=better-auth" first.'
      )
    }
    const marker = `provider-${id}`
    assertBlockAbsent(ctx, file, marker)
    return [
      {
        kind: "inject",
        path: file,
        marker,
        content: providerBlock(id),
        after: PROVIDERS_ANCHOR,
      },
      {
        kind: "inject",
        path: ".env.example",
        marker: `auth-${marker}`,
        content: providerEnv(id)
          .map((name) => `${name}=`)
          .join("\n"),
      },
    ]
  },
})

const authProvider = defineWeeCommand({
  meta: {
    name: "auth:provider",
    description: authProviderGenerator.description,
  },
  args: authProviderGenerator.args,
  run: (ctx, args) =>
    runGenerator({ ctx, generator: authProviderGenerator, args }),
})

export { authProvider, authProviderGenerator }
