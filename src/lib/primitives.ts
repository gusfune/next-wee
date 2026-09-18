/**
 * Maps source files to the primitives of the spec table. `stats` counts
 * lines per primitive and `notes` walks the same file list.
 */
import { glob } from "tinyglobby"
import type { Context } from "../core/context.js"
import { sourceDir } from "../core/context.js"

/** Table order. `test` and `e2e` count as tests; the rest counts as code. */
const PRIMITIVE_ORDER = [
  "model",
  "migration",
  "seed",
  "validator",
  "service",
  "action",
  "page",
  "layout",
  "boundary",
  "handler",
  "metadata",
  "component",
  "form",
  "hook",
  "helper",
  "provider",
  "type",
  "proxy",
  "env",
  "job",
  "email",
  "auth",
  "test",
  "e2e",
] as const

type Primitive = (typeof PRIMITIVE_ORDER)[number]

const TEST_PRIMITIVES: readonly Primitive[] = ["test", "e2e"]

const BOUNDARY_FILES = ["loading.tsx", "error.tsx", "not-found.tsx"]
const METADATA_FILES = ["opengraph-image", "sitemap", "robots"]

/** Base name of a path, e.g. `page.tsx`. */
const baseName = (path: string): string => path.split("/").at(-1) ?? path

/** Rules for files under `app/`, matched on the file name only. */
const classifyAppFile = (path: string): Primitive | undefined => {
  const base = baseName(path)
  const stem = base.replace(/\.tsx?$/, "")
  if (base === "actions.ts") {
    return "action"
  }
  if (base === "page.tsx") {
    return "page"
  }
  if (base === "layout.tsx") {
    return "layout"
  }
  if (BOUNDARY_FILES.includes(base)) {
    return "boundary"
  }
  if (base === "route.ts") {
    return "handler"
  }
  if (METADATA_FILES.includes(stem)) {
    return "metadata"
  }
  return undefined
}

/** Directory prefixes in match order: the more specific prefix comes first. */
const DIRECTORY_RULES: ReadonlyArray<readonly [string, Primitive]> = [
  ["db/schema/", "model"],
  ["db/migrations/", "migration"],
  ["db/seeds/", "seed"],
  ["lib/validators/", "validator"],
  ["lib/auth/", "auth"],
  ["lib/", "helper"],
  ["services/", "service"],
  ["components/providers/", "provider"],
  ["hooks/", "hook"],
  ["types/", "type"],
  ["jobs/", "job"],
  ["emails/", "email"],
]

/**
 * Primitive of a path relative to the source root (forward slashes), or
 * `undefined` when the file is not one of the spec's primitives. Test
 * files win over their location so `services/posts.test.ts` is a test.
 */
const classifyPrimitive = (path: string): Primitive | undefined => {
  if (/\.test\.tsx?$/.test(path)) {
    return "test"
  }
  if (path.startsWith("e2e/") && path.endsWith(".spec.ts")) {
    return "e2e"
  }
  if (path === "db/seed.ts") {
    return "seed"
  }
  if (path === "proxy.ts") {
    return "proxy"
  }
  if (path === "env.ts") {
    return "env"
  }
  if (path.startsWith("app/")) {
    return classifyAppFile(path)
  }
  if (path.startsWith("components/")) {
    if (path.startsWith("components/providers/")) {
      return "provider"
    }
    return path.endsWith("-form.tsx") ? "form" : "component"
  }
  const rule = DIRECTORY_RULES.find(([prefix]) => path.startsWith(prefix))
  return rule?.[1]
}

/**
 * Target-relative paths of every `.ts`/`.tsx` file under the source root
 * plus `e2e/**\/*.spec.ts`, sorted. Build output and dependencies are
 * skipped.
 */
const listSourceFiles = async (ctx: Context): Promise<string[]> => {
  const src = sourceDir(ctx)
  const files = await glob(
    [`${src === "." ? "" : `${src}/`}**/*.{ts,tsx}`, "e2e/**/*.spec.ts"],
    {
      cwd: ctx.target.path,
      ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
    }
  )
  return [...new Set(files)].sort()
}

/** Path relative to the source root, e.g. `src/app/page.tsx` to `app/page.tsx`. */
const sourceRelative = (ctx: Context, path: string): string => {
  const src = sourceDir(ctx)
  return src !== "." && path.startsWith(`${src}/`)
    ? path.slice(src.length + 1)
    : path
}

export type { Primitive }
export {
  classifyPrimitive,
  listSourceFiles,
  PRIMITIVE_ORDER,
  sourceRelative,
  TEST_PRIMITIVES,
}
