import { describe, expect, it } from "vitest"
import {
  camelCase,
  kebabCase,
  pascalCase,
  plural,
  singular,
  snakeCase,
  titleCase,
} from "./inflect.js"

describe("plural", () => {
  it.each([
    ["post", "posts"],
    ["Post", "Posts"],
    ["category", "categories"],
    ["box", "boxes"],
    ["person", "people"],
    ["address", "addresses"],
    ["status", "statuses"],
    ["leaf", "leaves"],
    ["series", "series"],
    ["comment", "comments"],
  ])("%s -> %s", (input, expected) => {
    expect(plural(input)).toBe(expected)
  })
})

describe("singular", () => {
  it.each([
    ["posts", "post"],
    ["categories", "category"],
    ["boxes", "box"],
    ["people", "person"],
    ["addresses", "address"],
    ["statuses", "status"],
    ["leaves", "leaf"],
    ["series", "series"],
    ["Comments", "Comment"],
  ])("%s -> %s", (input, expected) => {
    expect(singular(input)).toBe(expected)
  })
})

describe("case conversion", () => {
  it("handles every input style", () => {
    for (const input of [
      "PostCard",
      "postCard",
      "post-card",
      "post_card",
      "post card",
    ]) {
      expect(pascalCase(input)).toBe("PostCard")
      expect(camelCase(input)).toBe("postCard")
      expect(kebabCase(input)).toBe("post-card")
      expect(snakeCase(input)).toBe("post_card")
      expect(titleCase(input)).toBe("Post Card")
    }
  })

  it("keeps acronyms together", () => {
    expect(kebabCase("HTMLParser")).toBe("html-parser")
    expect(pascalCase("api-key")).toBe("ApiKey")
  })
})
