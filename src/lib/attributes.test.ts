import { describe, expect, it } from "vitest"
import {
  buildModelSpec,
  parseAttribute,
  parseAttributes,
} from "./attributes.js"

describe("parseAttribute", () => {
  it("parses a plain type", () => {
    expect(parseAttribute("title:string")).toEqual({
      name: "title",
      column: "title",
      type: "string",
      unique: false,
      index: false,
      optional: false,
    })
  })

  it("parses modifiers in any order", () => {
    expect(
      parseAttribute("slug:string:unique:optional:default=hello")
    ).toMatchObject({
      unique: true,
      optional: true,
      defaultValue: "hello",
    })
  })

  it("parses enum members", () => {
    expect(
      parseAttribute("status:enum[draft,published]:default=draft")
    ).toMatchObject({
      type: "enum",
      values: ["draft", "published"],
      defaultValue: "draft",
    })
  })

  it("turns references into an indexed foreign key column", () => {
    expect(parseAttribute("author:references")).toMatchObject({
      name: "authorId",
      column: "author_id",
      references: "authors",
      index: true,
    })
    expect(parseAttribute("BlogCategory:references").column).toBe(
      "blog_category_id"
    )
  })

  it("rejects unknown types, modifiers and reserved names", () => {
    expect(() => parseAttribute("title:varchar")).toThrow(/unknown type/)
    expect(() => parseAttribute("title:string:nullable")).toThrow(
      /unknown modifier/
    )
    expect(() => parseAttribute("id:uuid")).toThrow(/added to every model/)
    expect(() => parseAttribute("title")).toThrow(/name:type/)
    expect(() => parseAttribute("status:enum[]")).toThrow(/at least one/)
  })
})

describe("parseAttributes", () => {
  it("rejects duplicates", () => {
    expect(() => parseAttributes(["a:string", "a:text"])).toThrow(/twice/)
  })
})

describe("buildModelSpec", () => {
  it.each([
    ["Post", "Post", "posts"],
    ["posts", "Post", "posts"],
    ["blog-category", "BlogCategory", "blog_categories"],
    ["Person", "Person", "people"],
  ])("%s -> %s / %s", (input, name, table) => {
    expect(buildModelSpec(input, [])).toEqual({ name, table, attributes: [] })
  })
})
