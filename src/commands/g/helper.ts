/**
 * `wee g helper <name> [--shared]`: a pure function and its test in
 * `lib/`. With `--shared` it goes to the shared package's `src/` and is
 * re-exported from its `index.ts`; the manifest lives in that package, so
 * `destroy helper <name>` needs the same `--package`.
 */
import type { FileChange } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { camelCase, kebabCase } from "../../lib/inflect.js"
import { helperTemplate, helperTestTemplate } from "../../templates/ui.js"
import { create, retargetToPackage, srcPath } from "./paths.js"

const helperGenerator = defineGenerator({
  name: "helper",
  description: "Pure helper function with a test",
  args: {
    name: {
      type: "positional",
      description: "Function name, e.g. formatMoney",
      required: true,
    },
    shared: {
      type: "boolean",
      description: "Write to the shared package instead of the app",
      default: false,
    },
  },
  manifestName: (args) => camelCase(args.name),
  run: async (ctx, args) => {
    const name = camelCase(args.name)
    const file = kebabCase(name)
    if (!args.shared) {
      assertAppRouter(ctx)
      return [
        create(ctx, srcPath(ctx, "lib", `${file}.ts`), helperTemplate(name)),
        create(
          ctx,
          srcPath(ctx, "lib", `${file}.test.ts`),
          helperTestTemplate(name)
        ),
      ]
    }
    const changes: FileChange[] = [
      create(ctx, srcPath(ctx, `${file}.ts`), helperTemplate(name)),
      create(ctx, srcPath(ctx, `${file}.test.ts`), helperTestTemplate(name)),
      {
        kind: "inject",
        path: srcPath(ctx, "index.ts"),
        marker: `helper-${file}`,
        content: `export * from "./${file}"`,
      },
    ]
    return changes
  },
})

const helper = defineWeeCommand({
  meta: { name: "helper", description: helperGenerator.description },
  args: helperGenerator.args,
  run: (ctx, args) =>
    runGenerator({
      ctx: args.shared ? retargetToPackage(ctx) : ctx,
      generator: helperGenerator,
      args,
    }),
})

export { helper, helperGenerator }
