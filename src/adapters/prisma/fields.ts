/**
 * Attribute to Prisma field mapping. One field line per attribute, plus
 * the relation line and `@@index` for `references`, and an `enum` block
 * for `enum`. Native types follow the Drizzle adapter's column choices so
 * both adapters create the same tables.
 */
import type { Attribute, DbProvider } from "../../core/adapters.js"
import { camelCase, pascalCase, singular } from "../../lib/inflect.js"
import { enumName } from "../validator.js"

/** One line of a model block, aligned by `formatFields`. */
interface FieldRow {
  name: string
  type: string
  attributes: string[]
}

/** Prisma enum type name, e.g. `PostStatus`. */
const enumTypeName = (table: string, attribute: Attribute): string =>
  pascalCase(enumName(table, attribute).sqlName)

/** PascalCase model name of a referenced table, e.g. `authors` to `Author`. */
const referencedModel = (table: string): string => pascalCase(singular(table))

const scalarType = (table: string, attribute: Attribute): string => {
  switch (attribute.type) {
    case "string":
    case "text":
    case "uuid":
    case "references":
      return "String"
    case "integer":
      return "Int"
    case "decimal":
      return "Decimal"
    case "boolean":
      return "Boolean"
    case "datetime":
      return "DateTime"
    case "json":
      return "Json"
    case "enum":
      return enumTypeName(table, attribute)
  }
}

/** `@db.*` native type, when the provider's default differs from the Drizzle column. */
const nativeType = (
  provider: DbProvider,
  attribute: Attribute
): string | undefined => {
  switch (provider) {
    case "postgres":
      switch (attribute.type) {
        case "string":
          return "@db.VarChar(255)"
        case "decimal":
          return "@db.Decimal(12, 2)"
        case "datetime":
          return "@db.Timestamptz(6)"
        case "uuid":
        case "references":
          return "@db.Uuid"
        default:
          return undefined
      }
    case "mysql":
      switch (attribute.type) {
        case "string":
          return "@db.VarChar(255)"
        case "text":
          return "@db.Text"
        case "decimal":
          return "@db.Decimal(12, 2)"
        case "uuid":
        case "references":
          return "@db.VarChar(36)"
        default:
          return undefined
      }
    case "sqlite":
      return undefined
  }
}

const defaultAttribute = (attribute: Attribute): string | undefined => {
  const value = attribute.defaultValue
  if (value === undefined) {
    return undefined
  }
  if (attribute.type === "datetime" && value === "now") {
    return "@default(now())"
  }
  if (attribute.type === "uuid" && value === "random") {
    return "@default(uuid())"
  }
  switch (attribute.type) {
    case "integer":
    case "decimal":
    case "boolean":
    case "enum":
      return `@default(${value})`
    default:
      return `@default(${JSON.stringify(value)})`
  }
}

/** Field rows for one attribute: the scalar, and the relation for `references`. */
const fieldRows = (
  provider: DbProvider,
  table: string,
  attribute: Attribute
): FieldRow[] => {
  const defaultValue = defaultAttribute(attribute)
  const native = nativeType(provider, attribute)
  const attributes = [
    ...(attribute.unique ? ["@unique"] : []),
    ...(defaultValue === undefined ? [] : [defaultValue]),
    ...(attribute.column === attribute.name
      ? []
      : [`@map("${attribute.column}")`]),
    ...(native === undefined ? [] : [native]),
  ]
  const rows: FieldRow[] = [
    {
      name: attribute.name,
      type: `${scalarType(table, attribute)}${attribute.optional ? "?" : ""}`,
      attributes,
    },
  ]
  if (attribute.type === "references" && attribute.references !== undefined) {
    const model = referencedModel(attribute.references)
    rows.push({
      name: attribute.name.replace(/Id$/, ""),
      type: `${model}${attribute.optional ? "?" : ""}`,
      attributes: [
        `@relation(fields: [${attribute.name}], references: [id], onDelete: Restrict)`,
      ],
    })
  }
  return rows
}

/** The primary key and timestamp fields every model has. */
const systemRows = (
  provider: DbProvider
): {
  id: FieldRow
  createdAt: FieldRow
  updatedAt: FieldRow
} => {
  const native = nativeType(provider, {
    name: "id",
    column: "id",
    type: "uuid",
    unique: false,
    index: false,
    optional: false,
  })
  const timestamp = nativeType(provider, {
    name: "createdAt",
    column: "created_at",
    type: "datetime",
    unique: false,
    index: false,
    optional: false,
  })
  const withNative = (attributes: string[]): string[] =>
    timestamp === undefined ? attributes : [...attributes, timestamp]
  return {
    id: {
      name: "id",
      type: "String",
      attributes: [
        "@id",
        "@default(uuid())",
        ...(native === undefined ? [] : [native]),
      ],
    },
    createdAt: {
      name: "createdAt",
      type: "DateTime",
      attributes: withNative(["@default(now())", '@map("created_at")']),
    },
    updatedAt: {
      name: "updatedAt",
      type: "DateTime",
      attributes: withNative([
        "@default(now())",
        "@updatedAt",
        '@map("updated_at")',
      ]),
    },
  }
}

/** `@@index([name])` line for an indexed attribute. */
const indexLine = (attribute: Attribute): string =>
  `@@index([${attribute.name}])`

/** `enum` block for an enum attribute. */
const enumBlock = (table: string, attribute: Attribute): string =>
  [
    `enum ${enumTypeName(table, attribute)} {`,
    ...(attribute.values ?? []).map((value) => `  ${value}`),
    "}",
  ].join("\n")

/** Renders rows as aligned field lines, the way `prisma format` does. */
const formatFields = (rows: FieldRow[]): string[] => {
  const nameWidth = Math.max(...rows.map((row) => row.name.length))
  const typeWidth = Math.max(...rows.map((row) => row.type.length))
  return rows.map((row) => {
    const head = `  ${row.name.padEnd(nameWidth)} ${row.type}`
    return row.attributes.length === 0
      ? head
      : `${head.padEnd(nameWidth + typeWidth + 3)} ${row.attributes.join(" ")}`
  })
}

/** Back-relation field for the referenced model, e.g. `posts Post[]`. */
const backRelationLine = (modelName: string, table: string): string =>
  `  ${camelCase(table)} ${modelName}[]`

export type { FieldRow }
export {
  backRelationLine,
  enumBlock,
  enumTypeName,
  fieldRows,
  formatFields,
  indexLine,
  referencedModel,
  systemRows,
}
