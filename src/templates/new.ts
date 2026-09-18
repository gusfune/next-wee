/**
 * Files of a fresh app from `wee new`. Versions come from this package's
 * own dependency list, so a new app starts on the toolchain wee is tested
 * against.
 */

import type { PackageManagerName } from "nypm"
import pkg from "../../package.json" with { type: "json" }
import { runScriptCommand, weeCommand } from "./ops.js"

interface NewAppOptions {
  name: string
  pm: PackageManagerName
  /** API only: no page, no nav, a health route instead. */
  api: boolean
  /** No Playwright, no e2e folder. */
  minimal: boolean
}

type Versions = Record<string, string>

const pinned = (names: string[]): Versions => {
  const known: Versions = { ...pkg.devDependencies, ...pkg.dependencies }
  return Object.fromEntries(
    names.map((name) => {
      const version = known[name]
      if (version === undefined) {
        throw new Error(`next-wee does not pin ${name}`)
      }
      return [name, version]
    })
  )
}

const sorted = (record: Versions): Versions =>
  Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  )

const packageJsonTemplate = (options: NewAppOptions): string => {
  const { name, minimal } = options
  const scripts: Record<string, string> = {
    dev: "wee dev",
    build: "wee build",
    start: "wee start",
    lint: "wee lint",
    typecheck: "wee typecheck",
    test: "wee test",
    ...(minimal ? {} : { "test:e2e": "wee test:e2e" }),
    ci: "wee ci",
  }
  const devDependencies = sorted({
    ...pinned([
      "@biomejs/biome",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "tsx",
      "typescript",
      "vitest",
      ...(minimal ? [] : ["@playwright/test"]),
    ]),
    "next-wee": pkg.version,
  })
  const json = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts,
    dependencies: sorted(pinned(["next", "react", "react-dom", "zod"])),
    devDependencies,
  }
  return `${JSON.stringify(json, null, 2)}\n`
}

const tsconfigTemplate = (): string =>
  `${JSON.stringify(
    {
      compilerOptions: {
        target: "es2022",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2
  )}\n`

const nextConfigTemplate = (): string => `import type { NextConfig } from "next"

const nextConfig: NextConfig = {}

export default nextConfig
`

const biomeTemplate = (): string =>
  `${JSON.stringify(
    {
      $schema: `https://biomejs.dev/schemas/${pkg.devDependencies["@biomejs/biome"]}/schema.json`,
      vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
      files: {
        includes: ["**", "!.next", "!node_modules", "!next-env.d.ts"],
      },
      formatter: { indentStyle: "space", indentWidth: 2, lineEnding: "lf" },
      javascript: {
        formatter: {
          quoteStyle: "double",
          semicolons: "asNeeded",
          trailingCommas: "es5",
        },
      },
      linter: { rules: { preset: "recommended" } },
    },
    null,
    2
  )}\n`

const vitestConfigTemplate =
  (): string => `import { defineConfig } from "vitest/config"

// Unit tests sit beside the source. Playwright owns \`e2e/\`.
export default defineConfig({
  test: { include: ["src/**/*.test.{ts,tsx}"] },
})
`

const layoutTemplate = (options: NewAppOptions): string => {
  const { name, api } = options
  return [
    'import type { Metadata } from "next"',
    'import type { ReactNode } from "react"',
    ...(api ? [] : ['import { Nav } from "@/components/nav"']),
    "",
    `const metadata: Metadata = { title: "${name}" }`,
    "",
    "const RootLayout = ({ children }: { children: ReactNode }) => (",
    '  <html lang="en">',
    ...(api
      ? ["    <body>{children}</body>"]
      : ["    <body>", "      <Nav />", "      {children}", "    </body>"]),
    "  </html>",
    ")",
    "",
    "export { metadata }",
    "export default RootLayout",
    "",
  ].join("\n")
}

const homePageTemplate = (name: string): string => `const HomePage = () => (
  <main>
    <h1>${name}</h1>
    <p>
      Run <code>wee g resource Post title:string</code> to add the first
      resource.
    </p>
  </main>
)

export default HomePage
`

const homePageTestTemplate = (name: string): string =>
  `import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import HomePage from "./page"

describe("HomePage", () => {
  it("renders the app name", () => {
    expect(renderToStaticMarkup(<HomePage />)).toContain("${name}")
  })
})
`

const healthRouteTemplate =
  (): string => `import { NextResponse } from "next/server"

const GET = () => NextResponse.json({ status: "ok" })

export { GET }
`

const healthRouteTestTemplate = (): string =>
  `import { describe, expect, it } from "vitest"
import { GET } from "./route"

describe("GET /api/health", () => {
  it("reports ok", async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })
})
`

const smokeSpecTemplate = (api: boolean): string =>
  api
    ? `import { expect, test } from "@playwright/test"

test("health route answers", async ({ request }) => {
  const response = await request.get("/api/health")
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual({ status: "ok" })
})
`
    : `import { expect, test } from "@playwright/test"

test("home page renders", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})
`

const gitignoreTemplate = (): string => `node_modules
.next
out
coverage
*.tsbuildinfo
next-env.d.ts
.env
.env.*.local
.env.local
local.sqlite
test-results
playwright-report
config/credentials/.age-identity
`

const envExampleTemplate =
  (): string => `# Copy to .env.local. \`wee g env NAME\` adds keys here and to src/env.ts.
`

const readmeTemplate = (options: NewAppOptions): string => {
  const { name, pm, minimal } = options
  const run = (script: string): string => runScriptCommand(pm, script)
  return `# ${name}

Next.js App Router app generated by [\`wee\`](https://github.com/gusfune/next-wee).

## Commands

| Command | Outcome |
|---|---|
| \`${run("dev")}\` | Prepare the database, start the dev server |
| \`${run("test")}\` | Vitest |
${minimal ? "" : `| \`${run("test:e2e")}\` | Playwright against a fresh database |\n`}| \`${run("lint")}\`, \`${run("typecheck")}\` | Biome, \`next typegen\` + \`tsc\` |
| \`${run("ci")}\` | Every step in \`config/ci.ts\`, stops at the first failure |
| \`${weeCommand(pm)} g resource Post title:string\` | A full CRUD flow |

\`CONVENTIONS.md\` lists where each file kind lives. \`AGENTS.md\` tells coding agents how to use the CLI.
`
}

export type { NewAppOptions }
export {
  biomeTemplate,
  envExampleTemplate,
  gitignoreTemplate,
  healthRouteTemplate,
  healthRouteTestTemplate,
  homePageTemplate,
  homePageTestTemplate,
  layoutTemplate,
  nextConfigTemplate,
  packageJsonTemplate,
  readmeTemplate,
  smokeSpecTemplate,
  tsconfigTemplate,
  vitestConfigTemplate,
}
