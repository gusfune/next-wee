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
      attribute.defaultValue = modifier.slice("default=".length)
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
