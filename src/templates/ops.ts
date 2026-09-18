/**
 * Templates for the operations commands: the Playwright config that
 * `test:e2e` and `new` write, `config/ci.ts` for `wee ci`, and the GitHub
 * Actions workflow that runs `wee ci` for a new app.
 */
import type { PackageManagerName } from "nypm"

/** `<pm> run <script>` for the detected package manager. */
const runScriptCommand = (pm: PackageManagerName, script: string): string =>
  pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`

/** `<pm> wee <args>`: the way to invoke the CLI under each package manager. */
const weeCommand = (pm: PackageManagerName): string => {
  switch (pm) {
    case "npm":
      return "npx wee"
    case "pnpm":
      return "pnpm wee"
    case "yarn":
      return "yarn wee"
    case "bun":
      return "bun wee"
    default:
      return "npx wee"
  }
}

const playwrightConfigTemplate = (pm: PackageManagerName): string => `/**
 * Playwright over \`e2e/\`. \`wee test:e2e\` prepares the database and runs
 * this. The dev server starts unless one already listens on the port
 * (CI always starts its own).
 */
import { defineConfig } from "@playwright/test"

const port = process.env.PORT ?? "3000"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: \`http://localhost:\${port}\`,
    trace: "on-first-retry",
  },
  webServer: {
    command: "${runScriptCommand(pm, "dev")}",
    url: \`http://localhost:\${port}\`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
`

const CI_STEPS = ["lint", "typecheck", "test", "test:e2e", "build"] as const

type BuiltInStep = (typeof CI_STEPS)[number]

const ciConfigTemplate = (steps: readonly string[]): string => `/**
 * Steps for \`wee ci\`, in order. A string names a built-in step (${CI_STEPS.join(", ")}).
 * An object runs a shell command in the app directory. The run stops at
 * the first failure.
 */
const steps: Array<string | { name: string; command: string }> = [
${steps.map((step) => `  "${step}",`).join("\n")}
]

export { steps }
`

interface WorkflowOptions {
  pm: PackageManagerName
  /** Installs a Chromium build before `wee ci` when the app has e2e tests. */
  e2e: boolean
  /** The Bun version pinned for `setup-bun`. */
  bunVersion: string | undefined
}

const setupSteps = (options: WorkflowOptions): string[] => {
  const { pm, bunVersion } = options
  const node = [
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
  ]
  switch (pm) {
    case "bun":
      return [
        "      - uses: oven-sh/setup-bun@v2",
        ...(bunVersion === undefined
          ? []
          : ["        with:", `          bun-version: ${bunVersion}`]),
        ...node,
        "      - run: bun install --frozen-lockfile",
      ]
    case "pnpm":
      return [
        "      - uses: pnpm/action-setup@v4",
        ...node,
        "          cache: pnpm",
        "      - run: pnpm install --frozen-lockfile",
      ]
    case "yarn":
      return [
        ...node,
        "          cache: yarn",
        "      - run: yarn install --immutable",
      ]
    default:
      return [...node, "          cache: npm", "      - run: npm ci"]
  }
}

const workflowTemplate = (options: WorkflowOptions): string => {
  const { pm, e2e } = options
  const dlx = pm === "npm" ? "npx" : pm === "bun" ? "bunx" : `${pm} exec`
  return [
    "name: ci",
    "",
    "on:",
    "  push:",
    "    branches: [main, staging]",
    "  pull_request:",
    "",
    "jobs:",
    "  ci:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...setupSteps(options),
    ...(e2e
      ? [`      - run: ${dlx} playwright install --with-deps chromium`]
      : []),
    `      - run: ${weeCommand(pm)} ci`,
    "",
  ].join("\n")
}

export type { BuiltInStep }
export {
  CI_STEPS,
  ciConfigTemplate,
  playwrightConfigTemplate,
  runScriptCommand,
  weeCommand,
  workflowTemplate,
}
