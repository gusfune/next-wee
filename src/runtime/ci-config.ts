/**
 * Runs inside the target app through tsx or bun: imports `config/ci.ts`
 * and prints its `steps` as JSON so the CLI, which runs on plain Node,
 * does not need to compile TypeScript itself.
 */
import { pathToFileURL } from "node:url"

const file = process.argv[2]
if (file === undefined) {
  process.stderr.write("usage: ci-config <config/ci.ts>\n")
  process.exit(2)
}

const loaded = (await import(pathToFileURL(file).href)) as {
  steps?: unknown
  default?: { steps?: unknown }
}
const steps = loaded.steps ?? loaded.default?.steps
process.stdout.write(`${JSON.stringify(steps ?? null)}\n`)
