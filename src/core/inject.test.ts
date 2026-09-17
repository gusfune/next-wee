import { describe, expect, it } from "vitest"
import { hasBlock, injectBlock, readBlock, removeBlock } from "./inject.js"

const id = "model-post"

describe("injectBlock", () => {
  it("appends a block with TS comments", () => {
    const result = injectBlock({
      source: "export * from './users'\n",
      path: "index.ts",
      id,
      content: "export * from './posts'",
    })
    expect(result).toBe(
      "export * from './users'\n// wee:begin model-post\nexport * from './posts'\n// wee:end model-post\n"
    )
  })

  it("inserts after an anchor line", () => {
    const source = "a\nb\nc\n"
    const result = injectBlock({
      source,
      path: "x.ts",
      id,
      content: "X",
      after: "b",
    })
    expect(result).toBe(
      "a\nb\n// wee:begin model-post\nX\n// wee:end model-post\nc\n"
    )
  })

  it("uses hash comments for env files and html comments for markdown", () => {
    expect(
      injectBlock({ source: "", path: ".env.example", id, content: "KEY=" })
    ).toBe("# wee:begin model-post\nKEY=\n# wee:end model-post\n")
    expect(
      injectBlock({ source: "", path: "README.md", id, content: "hi" })
    ).toContain("<!-- wee:begin model-post -->")
  })

  it("replaces an existing block instead of duplicating it", () => {
    const once = injectBlock({ source: "", path: "x.ts", id, content: "one" })
    const twice = injectBlock({
      source: once,
      path: "x.ts",
      id,
      content: "two",
    })
    expect(twice).toBe("// wee:begin model-post\ntwo\n// wee:end model-post\n")
  })
})

describe("removeBlock", () => {
  it("removes the block and keeps the rest", () => {
    const source = injectBlock({
      source: "a\nb\nc\n",
      path: "x.ts",
      id,
      content: "X",
      after: "b",
    })
    expect(hasBlock(source, "x.ts", id)).toBe(true)
    expect(readBlock(source, "x.ts", id)).toBe("X\n")
    expect(removeBlock(source, "x.ts", id)).toBe("a\nb\nc\n")
  })
})
