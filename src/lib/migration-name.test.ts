import { describe, expect, it } from "vitest"
import { parseMigrationName } from "./migration-name.js"

describe("parseMigrationName", () => {
  it("detects Add*To*", () => {
    expect(parseMigrationName("AddStatusToPosts")).toEqual({
      name: "add_status_to_posts",
      intent: { kind: "add", table: "posts" },
    })
    expect(parseMigrationName("AddSlugToBlogCategories").intent).toEqual({
      kind: "add",
      table: "blog_categories",
    })
  })

  it("detects Remove*From*", () => {
    expect(parseMigrationName("RemoveBodyFromPosts").intent).toEqual({
      kind: "remove",
      table: "posts",
    })
  })

  it("falls back to custom", () => {
    expect(parseMigrationName("BackfillSlugs")).toEqual({
      name: "backfill_slugs",
      intent: { kind: "custom" },
    })
  })

  it("refuses Create*", () => {
    expect(() => parseMigrationName("CreatePosts")).toThrow(/g model/)
  })
})
