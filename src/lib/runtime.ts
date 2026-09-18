/**
 * Location of the runtime scripts (`preload`, `ci-config`, `generator`).
 * They run inside the target app through tsx or bun, so the CLI hands
 * them over as a path: the bundled `dist/runtime/<name>.js` beside the
 * CLI, else the source file under `src/runtime/` during development.
 */
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const runtimeScript = (name: string): string => {
  const built = fileURLToPath(new URL(`./runtime/${name}.js`, import.meta.url))
  return existsSync(built)
    ? built
    : fileURLToPath(new URL(`../runtime/${name}.ts`, import.meta.url))
}

export { runtimeScript }
