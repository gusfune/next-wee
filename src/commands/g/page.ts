/** `wee g page <segment> [--layout] [--skip-loading] [--skip-error]`: page with its boundaries. */
import { join } from "node:path"
import type { FileChange } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { parseSegment } from "../../lib/segment.js"
import {
  errorTemplate,
  layoutTemplate,
  loadingTemplate,
  pageTemplate,
} from "../../templates/routes.js"
import { create, segmentDir } from "./paths.js"
import { segmentArg } from "./shared.js"

const pageGenerator = defineGenerator({
  name: "page",
  description: "Page with loading and error boundaries",
  args: {
    ...segmentArg,
    layout: {
      type: "boolean",
      description: "Also write layout.tsx",
      default: false,
    },
    "skip-loading": {
      type: "boolean",
      description: "Do not write loading.tsx",
      default: false,
    },
    "skip-error": {
      type: "boolean",
      description: "Do not write error.tsx",
      default: false,
    },
  },
  manifestName: (args) => parseSegment(args.segment).key,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const segment = parseSegment(args.segment)
    const dir = segmentDir(ctx, segment)
    const changes: FileChange[] = [
      create(ctx, join(dir, "page.tsx"), pageTemplate(segment)),
    ]
    if (!args["skip-loading"]) {
      changes.push(
        create(ctx, join(dir, "loading.tsx"), loadingTemplate(segment))
      )
    }
    if (!args["skip-error"]) {
      changes.push(create(ctx, join(dir, "error.tsx"), errorTemplate(segment)))
    }
    if (args.layout) {
      changes.push(
        create(ctx, join(dir, "layout.tsx"), layoutTemplate(segment))
      )
    }
    return changes
  },
})

const page = defineWeeCommand({
  meta: { name: "page", description: pageGenerator.description },
  args: pageGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: pageGenerator, args }),
})

export { page, pageGenerator }
