/**
 * `wee g type <Name> [members...|attrs...]`: a type file. Bare words make
 * a string literal union (`g type PaymentStatus paid pending`), `attr:type`
 * items make an interface, nothing makes an `unknown` alias to fill in.
 */
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { parseAttributes } from "../../lib/attributes.js"
import { kebabCase, pascalCase } from "../../lib/inflect.js"
import { typeTemplate } from "../../templates/ui.js"
import { create, srcPath } from "./paths.js"
import { splitPositionals } from "./shared.js"

const typeGenerator = defineGenerator({
  name: "type",
  description: "Type alias, literal union or interface",
  args: {
    name: {
      type: "positional",
      description: "Type name, e.g. PaymentStatus",
      required: true,
    },
  },
  manifestName: (args) => pascalCase(args.name),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const name = pascalCase(args.name)
    const { attributes, words } = splitPositionals(args._)
    if (attributes.length > 0 && words.length > 0) {
      throw new WeeError(
        "mixed-type-members",
        `${name}: pass either union members (paid pending) or fields (amount:integer), not both.`
      )
    }
    return [
      create(
        ctx,
        srcPath(ctx, "types", `${kebabCase(name)}.ts`),
        typeTemplate({
          name,
          attributes: parseAttributes(attributes),
          members: words,
        })
      ),
    ]
  },
})

const type = defineWeeCommand({
  meta: { name: "type", description: typeGenerator.description },
  args: typeGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: typeGenerator, args }),
})

export { type, typeGenerator }
