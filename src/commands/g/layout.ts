/** `wee g layout <segment>`: a layout for a segment or route group. */
import { join } from "node:path"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { parseSegment } from "../../lib/segment.js"
import { layoutTemplate } from "../../templates/routes.js"
import { create, segmentDir } from "./paths.js"
import { segmentArg } from "./shared.js"

const layoutGenerator = defineGenerator({
  name: "layout",
  description: "Layout for a segment or route group",
  args: segmentArg,
  manifestName: (args) => parseSegment(args.segment).key,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const segment = parseSegment(args.segment)
    return [
      create(
        ctx,
        join(segmentDir(ctx, segment), "layout.tsx"),
        layoutTemplate(segment)
      ),
    ]
  },
})

const layout = defineWeeCommand({
  meta: { name: "layout", description: layoutGenerator.description },
  args: layoutGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: layoutGenerator, args }),
})

export { layout, layoutGenerator }
