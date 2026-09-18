/**
 * `wee routes [--grep=<pattern>]`: table of route path, segment kinds, file
 * type and, after a `next build`, the rendering mode.
 */
import { defineWeeCommand } from "../core/command.js"
import { assertAppRouter } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { readPrerenderManifest, scanRoutes } from "../lib/routes.js"

const compileGrep = (pattern: string): RegExp => {
  try {
    return new RegExp(pattern)
  } catch (error) {
    throw new WeeError(
      "invalid-grep",
      `--grep is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

const routes = defineWeeCommand({
  meta: {
    name: "routes",
    description: "List routes with segment kinds, file type and rendering mode",
  },
  args: {
    grep: {
      type: "string",
      description: "Keep rows whose path or source matches this regex",
    },
  },
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const appDir = ctx.layout.appDir
    if (appDir === undefined) {
      throw new WeeError(
        "app-dir-missing",
        `${ctx.target.name} has no app/ directory`
      )
    }
    const grep = args.grep === undefined ? undefined : compileGrep(args.grep)
    const rows = scanRoutes({
      appDir,
      targetPath: ctx.target.path,
      manifest: readPrerenderManifest(ctx.target.path),
    }).filter(
      (row) =>
        grep === undefined || grep.test(row.path) || grep.test(row.source)
    )
    return {
      title: `${rows.length} routes`,
      data: rows.map((row) => ({ ...row })),
    }
  },
})

export { routes }
