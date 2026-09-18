/**
 * `wee g generator <Name>`: scaffolds a custom generator under
 * `tools/generators/<name>/`. The CLI discovers it by directory name, so
 * the next `wee g <name>` runs it with `--dry-run`, `--json` and `destroy`.
 */
import { join } from "node:path"
import { defineWeeCommand } from "../../core/command.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { GENERATORS_DIR } from "../../lib/custom.js"
import { kebabCase } from "../../lib/inflect.js"
import {
  customGeneratorTemplate,
  customTemplateFile,
} from "../../templates/custom.js"
import { builtInGenerators } from "./index.js"
import { create } from "./paths.js"

const generatorGenerator = defineGenerator({
  name: "generator",
  description: "Custom generator under tools/generators/<name>/",
  args: {
    name: {
      type: "positional",
      description: "Generator name, e.g. Widget (becomes `wee g widget`)",
      required: true,
    },
  },
  manifestName: (args) => kebabCase(args.name),
  run: async (ctx, args) => {
    const name = kebabCase(args.name)
    if (name in builtInGenerators) {
      throw new WeeError(
        "generator-reserved",
        `${name} is a built-in generator. Pick another name.`
      )
    }
    const dir = join(GENERATORS_DIR, name)
    return [
      create(ctx, join(dir, "index.ts"), customGeneratorTemplate(name)),
      create(
        ctx,
        join(dir, "templates", `${name}.ts.tpl`),
        customTemplateFile(name)
      ),
    ]
  },
})

const generator = defineWeeCommand({
  meta: { name: "generator", description: generatorGenerator.description },
  args: generatorGenerator.args,
  run: (ctx, args) =>
    runGenerator({ ctx, generator: generatorGenerator, args }),
})

export { generator, generatorGenerator }
