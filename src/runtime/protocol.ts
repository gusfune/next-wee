/**
 * Wire format between the CLI and `runtime/generator.ts`. The CLI passes
 * the input as one JSON argument; the runtime prints one marked line with
 * the output. Everything else the generator prints is forwarded as is.
 */
import type { Context } from "../core/context.js"

const GENERATOR_RESULT_MARKER = "__wee_generator__:"

interface GeneratorInput {
  ctx: Context
  rawArgs: string[]
}

export type { GeneratorInput }
export { GENERATOR_RESULT_MARKER }
