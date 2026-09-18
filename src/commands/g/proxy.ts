/**
 * `wee g proxy <name> [--matcher="/dashboard/:path*"]`: adds an interceptor
 * and its matcher entries to `proxy.ts`. The default matcher is
 * `/<name>/:path*`; several matchers are comma-separated.
 */
import type { FileChange } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { kebabCase } from "../../lib/inflect.js"
import {
  PROXY_ANCHORS,
  proxyInterceptorBlock,
  proxyMatcherBlock,
  proxyTemplate,
} from "../../templates/app.js"
import { assertBlockAbsent, srcPath } from "./paths.js"

const parseMatchers = (raw: string | undefined, name: string): string[] => {
  if (raw === undefined) {
    return [`/${kebabCase(name)}/:path*`]
  }
  const matchers = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const bad = matchers.filter((item) => !item.startsWith("/"))
  if (matchers.length === 0 || bad.length > 0) {
    throw new WeeError(
      "invalid-matcher",
      `--matcher takes paths that start with "/", e.g. "/dashboard/:path*"`
    )
  }
  return matchers
}

const proxyGenerator = defineGenerator({
  name: "proxy",
  description: "Request interceptor in proxy.ts",
  args: {
    name: {
      type: "positional",
      description: "Interceptor name, e.g. auth",
      required: true,
    },
    matcher: {
      type: "string",
      description: 'Comma-separated matchers, e.g. "/dashboard/:path*"',
    },
  },
  manifestName: (args) => kebabCase(args.name),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const name = kebabCase(args.name)
    const matchers = parseMatchers(args.matcher, name)
    const proxyFile = srcPath(ctx, "proxy.ts")
    const marker = `proxy-${name}`
    assertBlockAbsent(ctx, proxyFile, marker)
    const changes: FileChange[] = [
      { kind: "ensure", path: proxyFile, content: proxyTemplate() },
      {
        kind: "inject",
        path: proxyFile,
        marker,
        content: proxyInterceptorBlock({ name, matchers }),
        after: PROXY_ANCHORS.interceptors,
      },
      {
        kind: "inject",
        path: proxyFile,
        marker: `${marker}-matcher`,
        content: proxyMatcherBlock(matchers),
        after: PROXY_ANCHORS.matcher,
      },
    ]
    return changes
  },
})

const proxy = defineWeeCommand({
  meta: { name: "proxy", description: proxyGenerator.description },
  args: proxyGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: proxyGenerator, args }),
})

export { parseMatchers, proxy, proxyGenerator }
