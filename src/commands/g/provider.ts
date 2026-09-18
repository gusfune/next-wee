/** `wee g provider <Name>`: context provider, `use<Name>` hook and test. */
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { kebabCase, pascalCase } from "../../lib/inflect.js"
import { providerTemplate, providerTestTemplate } from "../../templates/ui.js"
import { create, srcPath } from "./paths.js"

/** `Theme` for `Theme`, `theme` or `ThemeProvider`. */
const providerName = (raw: string): string =>
  pascalCase(raw).replace(/Provider$/, "")

const providerGenerator = defineGenerator({
  name: "provider",
  description: "Context provider with a hook and a test",
  args: {
    name: {
      type: "positional",
      description: "Provider name, e.g. Theme",
      required: true,
    },
  },
  manifestName: (args) => providerName(args.name),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const name = providerName(args.name)
    const dir = srcPath(ctx, "components", "providers")
    const file = `${kebabCase(name)}-provider`
    return [
      create(ctx, `${dir}/${file}.tsx`, providerTemplate(name)),
      create(ctx, `${dir}/${file}.test.tsx`, providerTestTemplate(name)),
    ]
  },
})

const provider = defineWeeCommand({
  meta: { name: "provider", description: providerGenerator.description },
  args: providerGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: providerGenerator, args }),
})

export { provider, providerGenerator }
