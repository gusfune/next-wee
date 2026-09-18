/** `wee g component <Name> [--area=posts] [--client]`: component and its test. */
import { join } from "node:path"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { kebabCase, pascalCase } from "../../lib/inflect.js"
import { componentTemplate, componentTestTemplate } from "../../templates/ui.js"
import { create, fileName, srcPath } from "./paths.js"

const componentGenerator = defineGenerator({
  name: "component",
  description: "Component with a render test",
  args: {
    name: {
      type: "positional",
      description: "Component name, e.g. PostCard",
      required: true,
    },
    area: {
      type: "string",
      description: "Sub-directory under components/, e.g. posts",
    },
    client: {
      type: "boolean",
      description: 'Add the "use client" directive',
      default: false,
    },
  },
  manifestName: (args) => pascalCase(args.name),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const name = pascalCase(args.name)
    const dir =
      args.area === undefined
        ? srcPath(ctx, "components")
        : srcPath(ctx, "components", kebabCase(args.area))
    const file = fileName(name)
    return [
      create(
        ctx,
        join(dir, `${file}.tsx`),
        componentTemplate({ name, client: args.client })
      ),
      create(ctx, join(dir, `${file}.test.tsx`), componentTestTemplate(name)),
    ]
  },
})

const component = defineWeeCommand({
  meta: { name: "component", description: componentGenerator.description },
  args: componentGenerator.args,
  run: (ctx, args) =>
    runGenerator({ ctx, generator: componentGenerator, args }),
})

export { component, componentGenerator }
