/**
 * App Router scanner for `wee routes`. Walks `app/`, classifies every
 * segment and route file, and adds the rendering mode when a `.next`
 * build left a prerender manifest behind.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { z } from "zod"

type RouteFile = "page" | "layout" | "handler" | "metadata"

type PartKind =
  | "static"
  | "dynamic"
  | "catch-all"
  | "optional-catch-all"
  | "group"
  | "parallel"
  | "intercepting"

type RenderingMode = "static" | "isr" | "dynamic"

interface RouteRow {
  /** URL pattern with groups and slots removed, e.g. `/posts/[id]`. */
  path: string
  /** Distinct segment kinds in order of appearance, e.g. `static, dynamic`. */
  kinds: string
  file: RouteFile
  /** File path relative to the target, e.g. `src/app/posts/page.tsx`. */
  source: string
  rendering?: RenderingMode
}

const ROUTE_FILES: Record<string, RouteFile> = {
  page: "page",
  layout: "layout",
  route: "handler",
  sitemap: "metadata",
  robots: "metadata",
  "opengraph-image": "metadata",
  "twitter-image": "metadata",
  icon: "metadata",
  "apple-icon": "metadata",
  manifest: "metadata",
}

/** Directories Next never routes: private folders and node_modules. */
const isSkippedDir = (name: string): boolean =>
  name.startsWith("_") || name === "node_modules"

const classifyPart = (part: string): PartKind => {
  if (part.startsWith("[[...") && part.endsWith("]]")) {
    return "optional-catch-all"
  }
  if (part.startsWith("[...") && part.endsWith("]")) {
    return "catch-all"
  }
  if (part.startsWith("[") && part.endsWith("]")) {
    return "dynamic"
  }
  if (/^\((\.{1,3}|\.\.\.)\)/.test(part)) {
    return "intercepting"
  }
  if (part.startsWith("(") && part.endsWith(")")) {
    return "group"
  }
  if (part.startsWith("@")) {
    return "parallel"
  }
  return "static"
}

/** URL contribution of one directory, or undefined when it adds none. */
const urlPart = (part: string, kind: PartKind): string | undefined => {
  switch (kind) {
    case "group":
    case "parallel":
      return undefined
    case "intercepting":
      return part.replace(/^\([.]+\)/, "")
    default:
      return part
  }
}

const routeFile = (fileName: string): RouteFile | undefined => {
  const base = fileName.replace(/\.[^.]+$/, "")
  return ROUTE_FILES[base]
}

const prerenderManifestSchema = z.object({
  routes: z.record(
    z.string(),
    z.object({
      initialRevalidateSeconds: z.union([z.number(), z.literal(false)]),
    })
  ),
  dynamicRoutes: z.record(z.string(), z.unknown()),
})

type PrerenderManifest = z.infer<typeof prerenderManifestSchema>

/** Parsed `.next/prerender-manifest.json`, or undefined without a build. */
const readPrerenderManifest = (
  targetPath: string
): PrerenderManifest | undefined => {
  const file = join(targetPath, ".next", "prerender-manifest.json")
  if (!existsSync(file)) {
    return undefined
  }
  return prerenderManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")))
}

/**
 * Prerendered routes with `initialRevalidateSeconds: false` are static;
 * with a number they revalidate (ISR). Dynamic routes listed in the
 * manifest have `generateStaticParams`; anything else renders per request.
 */
const renderingMode = (
  path: string,
  manifest: PrerenderManifest
): RenderingMode => {
  const route = manifest.routes[path]
  if (route !== undefined) {
    return route.initialRevalidateSeconds === false ? "static" : "isr"
  }
  return path in manifest.dynamicRoutes ? "static" : "dynamic"
}

interface ScanOptions {
  /** Absolute `app/` directory. */
  appDir: string
  /** Target root; `source` is relative to it. */
  targetPath: string
  manifest?: PrerenderManifest | undefined
}

interface Walk {
  dir: string
  url: string[]
  kinds: PartKind[]
}

/** Every route file under `app/`, sorted by path then file kind. */
const scanRoutes = (options: ScanOptions): RouteRow[] => {
  const { appDir, targetPath, manifest } = options
  const rows: RouteRow[] = []
  const queue: Walk[] = [{ dir: appDir, url: [], kinds: [] }]
  for (let walk = queue.shift(); walk !== undefined; walk = queue.shift()) {
    for (const entry of readdirSync(walk.dir, { withFileTypes: true })) {
      const full = join(walk.dir, entry.name)
      if (entry.isDirectory()) {
        if (isSkippedDir(entry.name)) {
          continue
        }
        const kind = classifyPart(entry.name)
        const part = urlPart(entry.name, kind)
        queue.push({
          dir: full,
          url: part === undefined ? walk.url : [...walk.url, part],
          kinds: [...walk.kinds, kind],
        })
        continue
      }
      const file = routeFile(entry.name)
      if (file === undefined) {
        continue
      }
      const path = `/${walk.url.join("/")}`
      const kinds = [...new Set(walk.kinds)]
      const row: RouteRow = {
        path,
        kinds: kinds.length === 0 ? "static" : kinds.join(", "),
        file,
        source: relative(targetPath, full),
      }
      if (manifest !== undefined && (file === "page" || file === "handler")) {
        row.rendering = renderingMode(path, manifest)
      }
      rows.push(row)
    }
  }
  return rows.sort(
    (a, b) => a.path.localeCompare(b.path) || a.file.localeCompare(b.file)
  )
}

export type { PrerenderManifest, RenderingMode, RouteFile, RouteRow }
export { classifyPart, readPrerenderManifest, renderingMode, scanRoutes }
