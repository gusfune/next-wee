import { describe, expect, it } from "vitest"
import { paramsType, parseSegment } from "./segment.js"

describe("parseSegment", () => {
  it("parses static, group and dynamic parts", () => {
    const segment = parseSegment("/(shop)/posts/[id]/comments/")
    expect(segment.dir).toBe("(shop)/posts/[id]/comments")
    expect(segment.url).toBe("/posts/[id]/comments")
    expect(segment.staticUrl).toBe("/posts")
    expect(segment.params).toEqual([{ name: "id", kind: "single" }])
    expect(segment.title).toBe("Comments")
    expect(segment.modelName).toBe("Comment")
    expect(segment.key).toBe("shop-posts-id-comments")
  })

  it("titles a trailing param after the singular of its parent", () => {
    const segment = parseSegment("posts/[id]")
    expect(segment.title).toBe("Post")
    expect(segment.modelName).toBe("Post")
  })

  it("parses catch-all params", () => {
    expect(parseSegment("docs/[...slug]").params).toEqual([
      { name: "slug", kind: "catch-all" },
    ])
    expect(parseSegment("docs/[[...slug]]").params).toEqual([
      { name: "slug", kind: "optional-catch-all" },
    ])
    expect(
      paramsType([
        { name: "id", kind: "single" },
        { name: "slug", kind: "optional-catch-all" },
      ])
    ).toBe("{ id: string; slug?: string[] }")
  })

  it("handles the root segment", () => {
    const segment = parseSegment("")
    expect(segment.dir).toBe("")
    expect(segment.url).toBe("/")
    expect(segment.key).toBe("root")
    expect(segment.title).toBe("Home")
  })

  it("rejects malformed parts", () => {
    expect(() => parseSegment("posts/[[id]]")).toThrowError(
      /not a valid dynamic segment/
    )
    expect(() => parseSegment("posts/{id}")).toThrowError(/not a valid segment/)
  })
})
