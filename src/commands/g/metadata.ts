/**
 * `wee g metadata <segment> [--sitemap] [--og]`: sitemap and Open Graph
 * image. With no flag both are written. The sitemap is app-wide and lives
 * at `app/sitemap.ts`; the image lives in the segment.
 */
import { join } from "node:path"
import type { FileChange } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { parseSegment } from "../../lib/segment.js"
import { ogImageTemplate, sitemapTemplate } from "../../templates/routes.js"
import { create, segmentDir, srcPath } from "./paths.js"
import { segmentArg } from "./shared.js"

const metadataGenerator = defineGenerator({
  name: "metadata",
  description: "Sitemap and Open Graph image for a segment",
  args: {
    ...segmentArg,
    sitemap: {
      type: "boolean",
      description: "Write app/sitemap.ts",
      default: false,
    },
    og: {
      type: "boolean",
      description: "Write opengraph-image.tsx in the segment",
      default: false,
    },
  },
  manifestName: (args) => parseSegment(args.segment).key,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const segment = parseSegment(args.segment)
    const both = !args.sitemap && !args.og
    const changes: FileChange[] = []
    if (args.sitemap || both) {
      changes.push(
        create(ctx, srcPath(ctx, "app", "sitemap.ts"), sitemapTemplate(segment))
      )
    }
    if (args.og || both) {
      changes.push(
        create(
          ctx,
          join(segmentDir(ctx, segment), "opengraph-image.tsx"),
          ogImageTemplate(segment)
        )
      )
    }
    return changes
  },
})

const metadata = defineWeeCommand({
  meta: { name: "metadata", description: metadataGenerator.description },
  args: metadataGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: metadataGenerator, args }),
})

export { metadata, metadataGenerator }
