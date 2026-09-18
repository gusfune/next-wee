/** Postgres template output. The sqlite path is covered by the integration suite. */
import { describe, expect, it } from "vitest"
import { downSql } from "../src/adapters/drizzle/migrations.js"
import { editModelSource } from "../src/adapters/drizzle/model-edit.js"
import {
  modelTemplate,
  serviceTemplate,
} from "../src/adapters/drizzle/templates.js"
import { validatorTemplate } from "../src/adapters/validator.js"
import { buildModelSpec, parseAttributes } from "../src/lib/attributes.js"

const post = buildModelSpec(
  "Post",
  parseAttributes([
    "title:string:unique",
    "status:enum[draft,published]:default=draft",
    "author:references",
  ])
)

describe("postgres model template", () => {
  const source = modelTemplate("postgres", post)

  it("declares the enum, the table, the index and the reference", () => {
    expect(source).toContain(
      'const postStatus = pgEnum("post_status", ["draft", "published"])'
    )
    expect(source).toContain('import { authors } from "./authors"')
    expect(source).toContain('id: uuid("id").primaryKey().defaultRandom()')
    expect(source).toContain(
      'title: varchar("title", { length: 255 }).notNull().unique()'
    )
    expect(source).toContain(
      'status: postStatus("status").notNull().default("draft")'
    )
    expect(source).toContain(
      'authorId: uuid("author_id").notNull().references(() => authors.id, { onDelete: "restrict" })'
    )
    expect(source).toContain('index("posts_author_id_idx").on(table.authorId)')
    expect(source).toContain("export { postStatus, posts }")
  })

  it("round-trips add and remove edits", () => {
    const added = parseAttributes(["slug:string:index", "kind:enum[a,b]"])
    const edited = editModelSource({
      provider: "postgres",
      table: "posts",
      source,
      add: added,
      remove: [],
    })
    expect(edited).toContain('slug: varchar("slug", { length: 255 }).notNull()')
    expect(edited).toContain('const postKind = pgEnum("post_kind", ["a", "b"])')
    expect(edited).toContain('index("posts_slug_idx").on(table.slug)')
    expect(edited).toContain("export { postKind, postStatus, posts }")
    const reverted = editModelSource({
      provider: "postgres",
      table: "posts",
      source: edited,
      add: [],
      remove: added,
    })
    expect(reverted).toBe(source)
  })
})

describe("postgres down sql", () => {
  it("drops the table and its enum types", () => {
    expect(downSql("postgres", { kind: "create-table", model: post })).toBe(
      'DROP TABLE "posts";\n--> statement-breakpoint\nDROP TYPE "post_status";'
    )
  })

  it("re-adds removed columns with their full definition", () => {
    const removed = parseAttributes(["views:integer:default=0"])
    expect(
      downSql("postgres", {
        kind: "remove-columns",
        table: "posts",
        attributes: removed,
      })
    ).toBe('ALTER TABLE "posts" ADD COLUMN "views" integer DEFAULT 0 NOT NULL;')
  })
})

describe("validator and service templates", () => {
  it("validator marks defaulted and optional fields optional", () => {
    const source = validatorTemplate(post)
    expect(source).toContain("title: z.string().max(255),")
    expect(source).toContain("status: z.enum(postStatusValues).optional(),")
    expect(source).toContain("authorId: z.string().uuid(),")
  })

  it("mysql service inserts without returning", () => {
    const source = serviceTemplate("mysql", post)
    expect(source).toContain("crypto.randomUUID()")
    expect(source).not.toContain(".returning()")
  })
})
