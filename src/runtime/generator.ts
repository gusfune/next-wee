/**
 * Runs inside the target app through tsx or bun: imports a custom
 * generator from `tools/generators/<name>/index.ts`, parses the raw args
 * with the generator's own definition, calls `run` and prints the result.
 * The CLI applies the changes and writes the manifest, so a custom
 * generator gets `--dry-run`, `--json` and `destroy` without extra code.
 */
import { pathToFileURL } from "node:url"
import type { ArgsDef } from "citty"
import { parseArgs } from "citty"
import { globalArgs } from "../core/command.js"
import type { GeneratorDef } from "../core/generator.js"
import type { GeneratorInput } from "./protocol.js"
import { GENERATOR_RESULT_MARKER } from "./protocol.js"

const [file, input] = process.argv.slice(2)
if (file === undefined || input === undefined) {
  process.stderr.write("usage: generator <index.ts> <json input>\n")
  process.exit(2)
}

const isGenerator = (value: unknown): value is GeneratorDef<ArgsDef> => {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === "string" &&
    typeof candidate.args === "object" &&
    candidate.args !== null &&
    typeof candidate.manifestName === "function" &&
    typeof candidate.run === "function"
  )
}

const { ctx, rawArgs } = JSON.parse(input) as GeneratorInput
const loaded = (await import(pathToFileURL(file).href)) as {
  generator?: unknown
}
if (!isGenerator(loaded.generator)) {
  process.stderr.write(
    `${file} must export "generator" with name, args, manifestName and run\n`
  )
  process.exit(2)
}
const { generator } = loaded
const args = parseArgs(rawArgs, { ...generator.args, ...globalArgs })
const name = generator.manifestName(args)
const changes = await generator.run(ctx, args)
process.stdout.write(
  `${GENERATOR_RESULT_MARKER}${JSON.stringify({ name, args, changes })}\n`
)
