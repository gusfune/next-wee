/**
 * Parser for the `name:type[:modifier...]` attribute syntax used by
 * `g model` and `g migration`. `enum[a,b]` carries its members. Modifiers
 * are `unique`, `index`, `optional` and `default=<value>`.
 */
import type { Attribute, AttributeType, ModelSpec } from "../core/adapters.js"
import { WeeError } from "../core/errors.js"
import {
  camelCase,
  pascalCase,
  plural,
  singular,
  snakeCase,
} from "./inflect.js"

const ATTRIBUTE_TYPES: ReadonlySet<string> = new Set<AttributeType>([
  "string",
  "text",
  "integer",
  "decimal",
  "boolean",
  "datetime",
  "uuid",
  "json",
  "enum",
  "references",
])

/** Columns every model has. An attribute cannot reuse them. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "updatedAt",
])

const isAttributeType = (value: string): value is AttributeType =>
  ATTRIBUTE_TYPES.has(value)

/** Names and enum members land in TS, SQL and Prisma as bare identifiers. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isJson = (value: string): boolean => {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/** Why `value` is not a valid default for the attribute, or undefined when it is. */
const defaultProblem = (
  attribute: Attribute,
  value: string
): string | undefined => {
  switch (attribute.type) {
    case "integer":
      return /^-?\d+$/.test(value) ? undefined : "must be an integer"
    case "decimal":
      return /^-?\d+(\.\d+)?$/.test(value) ? undefined : "must be a number"
    case "boolean":
      return value === "true" || value === "false"
        ? undefined
        : "must be true or false"
    case "datetime":
      return value === "now" ? undefined : 'must be "now"'
    case "uuid":
    case "references":
      return value === "random" || UUID.test(value)
        ? undefined
        : 'must be "random" or a UUID'
    case "json":
      return isJson(value) ? undefined : "must be valid JSON"
    case "enum":
      return attribute.values?.includes(value)
        ? undefined
        : `must be one of ${attribute.values?.join(", ") ?? ""}`
    default:
      return undefined
  }
}

const parseType = (
  raw: string,
  attribute: string
): { type: AttributeType; values?: string[] } => {
  const enumMatch = raw.match(/^enum\[(.*)\]$/)
  if (enumMatch !== null) {
    const values = (enumMatch[1] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    if (values.length === 0) {
      throw new WeeError(
        "invalid-attribute",
        `${attribute}: enum needs at least one value, e.g. status:enum[draft,published]`
      )
    }
    const bad = values.find((value) => !IDENTIFIER.test(value))
    if (bad !== undefined) {
      throw new WeeError(
        "invalid-attribute",
        `${attribute}: enum value "${bad}" must be letters, digits and underscores, starting with a letter`
      )
    }
    return { type: "enum", values }
  }
  if (!isAttributeType(raw)) {
    throw new WeeError(
      "invalid-attribute",
      `${attribute}: unknown type "${raw}". Types: ${[...ATTRIBUTE_TYPES].join(", ")}`
    )
  }
  return { type: raw }
}

const parseAttribute = (raw: string): Attribute => {
  const [rawName, rawType, ...modifiers] = raw.split(":")
  if (rawName === undefined || rawName.length === 0 || rawType === undefined) {
    throw new WeeError(
      "invalid-attribute",
      `"${raw}" is not name:type[:modifier...]`
    )
  }
  const name = camelCase(rawName)
  if (!IDENTIFIER.test(name)) {
    throw new WeeError(
      "invalid-attribute",
      `${raw}: "${rawName}" does not make a valid identifier`
    )
  }
  if (RESERVED_NAMES.has(name)) {
    throw new WeeError(
      "invalid-attribute",
      `${raw}: "${name}" is added to every model. Pick another name.`
    )
  }
  const { type, values } = parseType(rawType, raw)
  const attribute: Attribute = {
    name: type === "references" ? `${name}Id` : name,
    column: type === "references" ? `${snakeCase(name)}_id` : snakeCase(name),
    type,
    unique: false,
    index: type === "references",
    optional: false,
  }
  if (values !== undefined) {
    attribute.values = values
  }
  if (type === "references") {
    attribute.references = plural(snakeCase(name))
  }
  for (const modifier of modifiers) {
    if (modifier === "unique") {
      attribute.unique = true
    } else if (modifier === "index") {
      attribute.index = true
    } else if (modifier === "optional") {
      attribute.optional = true
    } else if (modifier.startsWith("default=")) {
      const value = modifier.slice("default=".length)
      const problem = defaultProblem(attribute, value)
      if (problem !== undefined) {
        throw new WeeError("invalid-attribute", `${raw}: default ${problem}`)
      }
      attribute.defaultValue = value
    } else {
      throw new WeeError(
        "invalid-attribute",
        `${raw}: unknown modifier "${modifier}". Modifiers: unique, index, optional, default=<value>`
      )
    }
  }
  return attribute
}

const parseAttributes = (raw: string[]): Attribute[] => {
  const attributes = raw.map(parseAttribute)
  const seen = new Set<string>()
  for (const attribute of attributes) {
    if (seen.has(attribute.name)) {
      throw new WeeError(
        "invalid-attribute",
        `"${attribute.name}" is given twice`
      )
    }
    seen.add(attribute.name)
  }
  return attributes
}

/** Builds the model spec from any spelling of the name: `Post`, `posts`, `blog-post`. */
const buildModelSpec = (name: string, attributes: Attribute[]): ModelSpec => {
  const singularName = pascalCase(singular(name))
  return {
    name: singularName,
    table: snakeCase(plural(singularName)),
    attributes,
  }
}

export { buildModelSpec, parseAttribute, parseAttributes }
