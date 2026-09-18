/**
 * Text edits on a `<table>.prisma` file written by `modelTemplate`, used
 * by `g migration`. Fields go in before `createdAt`, indexes before
 * `@@map`, enums before the model. The edit fails when the file does not
 * have that shape.
 */
import type { Attribute, DbProvider } from "../../core/adapters.js"
import { WeeError } from "../../core/errors.js"
import type { FieldRow } from "./fields.js"
import {
  enumBlock,
  enumTypeName,
  fieldRows,
  formatFields,
  indexLine,
} from "./fields.js"

interface ModelEdit {
  provider: DbProvider
  table: string
  source: string
  add: Attribute[]
  remove: Attribute[]
}

const fail = (table: string, reason: string): never => {
  throw new WeeError(
    "model-not-editable",
    `${table}: ${reason}. Edit the model by hand, then run "wee db:generate".`
  )
}

const FIELD_LINE = /^ {2}(\w+) +(\S+)(?: +(.*))?$/

/** Re-aligns every field line of the model block. */
const alignModel = (source: string): string => {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => /^model \w+ \{$/.test(line))
  const end = lines.indexOf("}", start)
  if (start === -1 || end === -1) {
    return source
  }
  const body = lines.slice(start + 1, end)
  const rows: FieldRow[] = []
  for (const line of body) {
    const match = line.match(FIELD_LINE)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      rows.push({
        name: match[1],
        type: match[2],
        attributes: match[3] === undefined ? [] : [match[3]],
      })
    }
  }
  const formatted = formatFields(rows)
  let index = 0
  const next = body.map((line) => {
    if (!FIELD_LINE.test(line)) {
      return line
    }
    const out = formatted[index] ?? line
    index += 1
    return out
  })
  return [...lines.slice(0, start + 1), ...next, ...lines.slice(end)].join("\n")
}

const addFields = (edit: ModelEdit): string => {
  const { provider, table, add } = edit
  let source = edit.source
  const anchor = /^ {2}createdAt +DateTime/m
  if (!anchor.test(source)) {
    return fail(table, 'cannot find the "createdAt" field')
  }
  const rows = add.flatMap((attribute) => fieldRows(provider, table, attribute))
  const lines = rows
    .map((row) => `  ${row.name} ${row.type} ${row.attributes.join(" ")}`)
    .join("\n")
  source = source.replace(anchor, (match) => `${lines}\n${match}`)
  for (const attribute of add) {
    if (attribute.type === "enum") {
      source = `${enumBlock(table, attribute)}\n\n${source}`
    }
    if (attribute.index) {
      source = source.replace(
        /^ {2}@@map\(/m,
        (match) => `  ${indexLine(attribute)}\n${match}`
      )
    }
  }
  return alignModel(source)
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const removeFields = (edit: ModelEdit): string => {
  const { table, remove } = edit
  let source = edit.source
  for (const attribute of remove) {
    const names = [
      attribute.name,
      ...(attribute.type === "references"
        ? [attribute.name.replace(/Id$/, "")]
        : []),
    ]
    for (const name of names) {
      const line = new RegExp(`^ {2}${escapeRegExp(name)} +.*\\n`, "m")
      if (!line.test(source)) {
        return fail(table, `field "${name}" not found`)
      }
      source = source.replace(line, "")
    }
    source = source.replace(
      new RegExp(`^ {2}${escapeRegExp(indexLine(attribute))}\\n`, "m"),
      ""
    )
    if (attribute.type === "enum") {
      source = source.replace(
        new RegExp(
          `^enum ${enumTypeName(table, attribute)} \\{[^}]*\\}\\n\\n`,
          "m"
        ),
        ""
      )
    }
  }
  return alignModel(source)
}

/** Applies the add and remove lists to the model source and returns the new text. */
const editModelSource = (edit: ModelEdit): string => {
  const added = edit.add.length > 0 ? addFields(edit) : edit.source
  return edit.remove.length > 0
    ? removeFields({ ...edit, source: added })
    : added
}

export type { ModelEdit }
export { editModelSource }
