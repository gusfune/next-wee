import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PrerenderManifest } from "./routes.js"
import { classifyPart, renderingMode, scanRoutes } from "./routes.js"

let root: string

const touch = (path: string): void => {
  mkdirSync(join(root, "src/app", path, ".."), { recursive: true })
  writeFileSync(join(root, "src/app", path), "")
}

describe("classifyPart", () => {
  it("names every segment form", () => {
    expect(classifyPart("posts")).toBe("static")
    expect(classifyPart("[id]")).toBe("dynamic")
    expect(classifyPart("[...slug]")).toBe("catch-all")
    expect(classifyPart("[[...slug]]")).toBe("optional-catch-all")
    expect(classifyPart("(marketing)")).toBe("group")
    expect(classifyPart("@modal")).toBe("parallel")
    expect(classifyPart("(.)photo")).toBe("intercepting")
    expect(classifyPart("(..)photo")).toBe("intercepting")
    expect(classifyPart("(...)photo")).toBe("intercepting")
  })
})

describe("scanRoutes", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "wee-routes-"))
    touch("layout.tsx")
    touch("page.tsx")
    touch("sitemap.ts")
    touch("posts/page.tsx")
    touch("posts/loading.tsx")
    touch("posts/[id]/page.tsx")
    touch("posts/[id]/opengraph-image.png")
    touch("(marketing)/about/page.tsx")
    touch("@modal/(.)photo/[id]/page.tsx")
    touch("api/[...slug]/route.ts")
    touch("_private/page.tsx")
    touch("docs/[[...slug]]/page.tsx")
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("lists route files with url, kinds and source", () => {
    const rows = scanRoutes({ appDir: join(root, "src/app"), targetPath: root })
    expect(rows.map((row) => `${row.path} ${row.file} ${row.kinds}`)).toEqual([
      "/ layout static",
      "/ metadata static",
      "/ page static",
      "/about page group, static",
      "/api/[...slug] handler static, catch-all",
      "/docs/[[...slug]] page static, optional-catch-all",
      "/photo/[id] page parallel, intercepting, dynamic",
      "/posts page static",
      "/posts/[id] metadata static, dynamic",
      "/posts/[id] page static, dynamic",
    ])
    expect(rows[0]?.source).toBe("src/app/layout.tsx")
    expect(rows.every((row) => row.rendering === undefined)).toBe(true)
  })

  it("adds the rendering mode from a prerender manifest", () => {
    const manifest: PrerenderManifest = {
      routes: {
        "/": { initialRevalidateSeconds: false },
        "/about": { initialRevalidateSeconds: 60 },
      },
      dynamicRoutes: { "/docs/[[...slug]]": {} },
    }
    expect(renderingMode("/", manifest)).toBe("static")
    expect(renderingMode("/about", manifest)).toBe("isr")
    expect(renderingMode("/docs/[[...slug]]", manifest)).toBe("static")
    expect(renderingMode("/posts/[id]", manifest)).toBe("dynamic")
    const rows = scanRoutes({
      appDir: join(root, "src/app"),
      targetPath: root,
      manifest,
    })
    const page = rows.find((row) => row.path === "/" && row.file === "page")
    const layout = rows.find((row) => row.file === "layout")
    expect(page?.rendering).toBe("static")
    expect(layout?.rendering).toBeUndefined()
  })
})
