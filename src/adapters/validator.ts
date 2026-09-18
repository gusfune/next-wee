/**
 * Zod validator templates shared by every `DbAdapter`. Validators describe
 * the attribute grammar, not the ORM, so Drizzle and Prisma emit the same
 * file. The helpers for enum names and literals live here for the same
 * reason.
 */
import type { Attribute, ModelSpec } from "../core/adapters.js"
import { camelCase, kebabCase, singular } from "../lib/inflect.js"

/** Name of the enum variable and SQL type, e.g. `postStatus` / `post_status`. */
const enumName = (
  table: string,
  attribute: Attribute
): { variable: string; sqlName: string } => {
  const sqlName = `${singular(table)}_${attribute.column}`
  return { variable: camelCase(sqlName), sqlName }
}

const quoteLiteral = (value: string): string =>
  `"${value.replace(/"/g, '\\"')}"`

const isNumeric = (attribute: Attribute): boolean =>
  attribute.type === "integer" || attribute.type === "decimal"

/** Zod schema for one attribute in the insert validator. */
const zodCode = (model: ModelSpec, attribute: Attribute): string => {
  const base = ((): string => {
    switch (attribute.type) {
      case "string":
        return "z.string().max(255)"
      case "text":
        return "z.string()"
      case "integer":
        return "z.number().int()"
      case "decimal":
        return "z.number()"
      case "boolean":
        return "z.boolean()"
      case "datetime":
        return "z.date()"
      case "uuid":
      case "references":
        return "z.string().uuid()"
      case "json":
        return "z.unknown()"
      case "enum":
        return `z.enum(${enumName(model.table, attribute).variable}Values)`
    }
  })()
  const omittable = attribute.optional || attribute.defaultValue !== undefined
  return omittable ? `${base}.optional()` : base
}

/** A value that passes the attribute's validator. Used in generated tests. */
const sampleValue = (attribute: Attribute): string => {
  switch (attribute.type) {
    case "string":
      return '"Example"'
    case "text":
      return '"Example text"'
    case "integer":
      return "1"
    case "decimal":
      return "1.5"
    case "boolean":
      return "true"
    case "datetime":
      return 'new Date("2026-01-01T00:00:00.000Z")'
    case "uuid":
    case "references":
      return '"00000000-0000-4000-8000-000000000000"'
    case "json":
      return "{}"
    case "enum":
      return quoteLiteral(attribute.values?.[0] ?? "")
  }
}

/** A value that fails the attribute's validator. */
const wrongValue = (attribute: Attribute): string =>
  attribute.type === "json"
    ? "undefined"
    : isNumeric(attribute)
      ? '"not a number"'
      : "123"

const validatorTemplate = (model: ModelSpec): string => {
  const enums = model.attributes.filter(
    (attribute) => attribute.type === "enum"
  )
  const lines: string[] = ['import { z } from "zod"', ""]
  for (const attribute of enums) {
    const values = (attribute.values ?? []).map(quoteLiteral).join(", ")
    lines.push(
      `const ${enumName(model.table, attribute).variable}Values = [${values}] as const`,
      ""
    )
  }
  lines.push(`const insert${model.name}Schema = z.object({`)
  for (const attribute of model.attributes) {
    lines.push(`  ${attribute.name}: ${zodCode(model, attribute)},`)
  }
  lines.push("})", "")
  lines.push(
    `const update${model.name}Schema = insert${model.name}Schema.partial()`,
    ""
  )
  lines.push(`const ${camelCase(model.name)}QuerySchema = z.object({`)
  lines.push("  page: z.coerce.number().int().min(1).default(1),")
  lines.push("  perPage: z.coerce.number().int().min(1).max(100).default(20),")
  lines.push("})", "")
  lines.push(
    `type Insert${model.name} = z.infer<typeof insert${model.name}Schema>`
  )
  lines.push(
    `type Update${model.name} = z.infer<typeof update${model.name}Schema>`
  )
  lines.push(
    `type ${model.name}Query = z.infer<typeof ${camelCase(model.name)}QuerySchema>`
  )
  lines.push("")
  lines.push(
    `export type { Insert${model.name}, ${model.name}Query, Update${model.name} }`
  )
  const exported = [
    ...enums.map(
      (attribute) => `${enumName(model.table, attribute).variable}Values`
    ),
    `insert${model.name}Schema`,
    `${camelCase(model.name)}QuerySchema`,
    `update${model.name}Schema`,
  ].sort()
  lines.push(`export { ${exported.join(", ")} }`, "")
  return lines.join("\n")
}

const validatorTestTemplate = (model: ModelSpec): string => {
  const schema = `insert${model.name}Schema`
  const file = kebabCase(model.name)
  const valid = model.attributes
    .map((attribute) => `  ${attribute.name}: ${sampleValue(attribute)},`)
    .join("\n")
  const required = model.attributes.find(
    (attribute) => !attribute.optional && attribute.defaultValue === undefined
  )
  const first = model.attributes[0]
  const lines: string[] = [
    'import { describe, expect, it } from "vitest"',
    `import { ${schema} } from "./${file}"`,
    "",
    `const valid = {`,
    ...(valid.length > 0 ? [valid] : []),
    "}",
    "",
    `describe("${schema}", () => {`,
    `  it("accepts a valid ${model.name}", () => {`,
    `    expect(${schema}.safeParse(valid).success).toBe(true)`,
    "  })",
  ]
  if (required !== undefined) {
    lines.push(
      "",
      `  it("rejects a missing ${required.name}", () => {`,
      `    expect(${schema}.safeParse({ ...valid, ${required.name}: undefined }).success).toBe(false)`,
      "  })"
    )
  } else if (first !== undefined) {
    lines.push(
      "",
      `  it("rejects a wrong ${first.name}", () => {`,
      `    expect(${schema}.safeParse({ ...valid, ${first.name}: ${wrongValue(first)} }).success).toBe(false)`,
      "  })"
    )
  }
  lines.push("})", "")
  return lines.join("\n")
}

export {
  enumName,
  isNumeric,
  quoteLiteral,
  sampleValue,
  validatorTemplate,
  validatorTestTemplate,
  wrongValue,
  zodCode,
}
