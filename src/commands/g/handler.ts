/** `wee g handler <segment> [--methods=GET,POST]`: a route handler with typed methods. */
import { join } from "node:path"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { parseSegment } from "../../lib/segment.js"
import type { HttpMethod } from "../../templates/routes.js"
import {
  HTTP_METHODS,
  handlerTemplate,
  isHttpMethod,
} from "../../templates/routes.js"
import { create, segmentDir } from "./paths.js"
import { segmentArg } from "./shared.js"

/** Parses `GET,POST` into unique methods, in HTTP_METHODS order. */
const parseMethods = (raw: string): HttpMethod[] => {
  const wanted = raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0)
  const unknown = wanted.filter((item) => !isHttpMethod(item))
  if (unknown.length > 0) {
    throw new WeeError(
      "invalid-method",
      `Unknown method(s) ${unknown.join(", ")}. Use ${HTTP_METHODS.join(", ")}.`
    )
  }
  const methods = HTTP_METHODS.filter((method) => wanted.includes(method))
  if (methods.length === 0) {
    throw new WeeError("invalid-method", "--methods needs at least one method")
  }
  return methods
}

const handlerGenerator = defineGenerator({
  name: "handler",
  description: "Route handler (route.ts) with the given methods",
  args: {
    ...segmentArg,
    methods: {
      type: "string",
      description: "Comma-separated HTTP methods",
      default: "GET",
    },
  },
  manifestName: (args) => parseSegment(args.segment).key,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const segment = parseSegment(args.segment)
    const methods = parseMethods(args.methods)
    return [
      create(
        ctx,
        join(segmentDir(ctx, segment), "route.ts"),
        handlerTemplate({ segment, methods })
      ),
    ]
  },
})

const handler = defineWeeCommand({
  meta: { name: "handler", description: handlerGenerator.description },
  args: handlerGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: handlerGenerator, args }),
})

export { handler, handlerGenerator, parseMethods }
