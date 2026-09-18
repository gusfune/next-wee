/** `wee g hook <useName>`: a state hook and its test. */
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import {
  hookNames,
  hookTemplate,
  hookTestTemplate,
} from "../../templates/ui.js"
import { create, srcPath } from "./paths.js"

const hookGenerator = defineGenerator({
  name: "hook",
  description: "React hook with a test",
  args: {
    name: {
      type: "positional",
      description: "Hook name, e.g. useComments",
      required: true,
    },
  },
  manifestName: (args) => hookNames(args.name).hook,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const { file } = hookNames(args.name)
    return [
      create(ctx, srcPath(ctx, "hooks", `${file}.ts`), hookTemplate(args.name)),
      create(
        ctx,
        srcPath(ctx, "hooks", `${file}.test.tsx`),
        hookTestTemplate(args.name)
      ),
    ]
  },
})

const hook = defineWeeCommand({
  meta: { name: "hook", description: hookGenerator.description },
  args: hookGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: hookGenerator, args }),
})

export { hook, hookGenerator }
