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

describe("decimal, datetime and default values", () => {
  const order = buildModelSpec(
    "Order",
    parseAttributes([
      "price:decimal",
      "placedAt:datetime:default=now",
      "token:uuid:default=random",
    ])
  )

  it("decimal columns read as numbers, as the validator expects", () => {
    expect(modelTemplate("postgres", order)).toContain(
      'numeric("price", { mode: "number" })'
    )
    expect(modelTemplate("mysql", order)).toContain('mode: "number"')
    expect(validatorTemplate(order)).toContain("price: z.number(),")
  })

  it("datetime validators coerce ISO strings from JSON bodies", () => {
    expect(validatorTemplate(order)).toContain("z.coerce.date()")
  })

  it("down sql maps now and random to SQL expressions", () => {
    const sql = downSql("postgres", {
      kind: "remove-columns",
      table: "orders",
      attributes: order.attributes,
    })
    expect(sql).toContain("DEFAULT CURRENT_TIMESTAMP")
    expect(sql).toContain("DEFAULT gen_random_uuid()")
    expect(sql).not.toContain("'now'")
    expect(sql).not.toContain("'random'")
  })

  it("a second reference to the same table reuses the import", () => {
    const edited = editModelSource({
      provider: "postgres",
      table: "posts",
      source: modelTemplate("postgres", post),
      add: parseAttributes(["author:references"]).map((attribute) => ({
        ...attribute,
        name: "editorId",
        column: "editor_id",
      })),
      remove: [],
    })
    expect(edited.match(/import \{ authors \}/g)).toHaveLength(1)
  })
})

describe("attribute validation", () => {
  it.each([
    ["status:enum[draft,it's]", "enum value"],
    ["views:integer:default=many", "must be an integer"],
    ["price:decimal:default=1e3", "must be a number"],
    ["live:boolean:default=yes", "true or false"],
    ["at:datetime:default=tomorrow", '"now"'],
    ["token:uuid:default=abc", "UUID"],
    ["meta:json:default={bad", "valid JSON"],
    ["status:enum[a,b]:default=c", "one of a, b"],
    ["9lives:string", "valid identifier"],
  ])("rejects %s", (raw, message) => {
    expect(() => parseAttributes([raw])).toThrow(message)
  })

  it("accepts valid defaults", () => {
    expect(
      parseAttributes([
        "views:integer:default=-1",
        "price:decimal:default=9.99",
        "meta:json:default={}",
        "status:enum[a,b]:default=b",
      ])
    ).toHaveLength(4)
  })
})
