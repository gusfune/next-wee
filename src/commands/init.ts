/** `wee init`: writes `.app/config.json` and `CONVENTIONS.md` into an existing App Router app. */
import { join } from "node:path"
import { defineWeeCommand } from "../core/command.js"
import type { AppConfig } from "../core/config.js"
import { CONFIG_DIR, CONFIG_FILE } from "../core/config.js"
import { assertAppRouter } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { defineGenerator, runGenerator } from "../core/generator.js"
import { conventionsTemplate } from "../templates/conventions.md.js"

const initGenerator = defineGenerator({
  name: "init",
  description: "Create .app/config.json and CONVENTIONS.md",
  args: {},
  manifestName: () => "app",
  run: async (ctx) => {
    assertAppRouter(ctx)
    if (ctx.hasConfigFile && !ctx.flags.force) {
      throw new WeeError(
        "already-initialised",
        `${ctx.configPath} exists. Pass --force to overwrite.`
      )
    }
    const config: AppConfig = {
      router: "app",
      srcDir: ctx.config.srcDir ?? true,
      ...(ctx.config.db === undefined ? {} : { db: ctx.config.db }),
      ...(ctx.config.auth === undefined ? {} : { auth: ctx.config.auth }),
    }
    const configKind = ctx.hasConfigFile ? "modify" : "create"
    return [
      {
        kind: configKind,
        path: join(CONFIG_DIR, CONFIG_FILE),
        content: `${JSON.stringify(config, null, 2)}\n`,
      },
      {
        kind: "create",
        path: "CONVENTIONS.md",
        content: conventionsTemplate(config),
      },
    ]
  },
})

const init = defineWeeCommand({
  meta: { name: "init", description: initGenerator.description },
  run: async (ctx, args) =>
    runGenerator({ ctx, generator: initGenerator, args }),
})

export { init, initGenerator }
