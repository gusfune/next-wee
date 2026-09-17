/**
 * Text edits on a model file written by `modelTemplate`, used by
 * `g migration`. Columns are inserted before `createdAt` and removed by
 * name. The edit fails when the file does not have that shape.
 */
import type { Attribute, DbProvider } from "../../core/adapters.js"
import { WeeError } from "../../core/errors.js"
import { camelCase, kebabCase } from "../../lib/inflect.js"
import { CORE_MODULE, columnCode, enumName, quoteLiteral } from "./columns.js"
import { indexCode } from "./templates.js"

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

const mergeImport = (
  source: string,
  module: string,
  names: string[]
): string => {
  const pattern = new RegExp(`^import \\{ ([^}]+) \\} from "${module}"$`, "m")
  const match = source.match(pattern)
  if (match?.[1] === undefined) {
    return `import { ${[...names].sort().join(", ")} } from "${module}"\n${source}`
  }
  const merged = [
    ...new Set([...match[1].split(",").map((name) => name.trim()), ...names]),
  ].sort()
  return source.replace(
    pattern,
    `import { ${merged.join(", ")} } from "${module}"`
  )
}

const addExport = (source: string, name: string): string => {
  const pattern = /^export \{ ([^}]+) \}$/m
  const match = source.match(pattern)
  if (match?.[1] === undefined) {
    return `${source}export { ${name} }\n`
  }
  const merged = [
    ...new Set([...match[1].split(",").map((entry) => entry.trim()), name]),
  ].sort()
  return source.replace(pattern, `export { ${merged.join(", ")} }`)
}

const addIndexes = (
  source: string,
  table: string,
  attributes: Attribute[]
): string => {
  if (attributes.length === 0) {
    return source
  }
  const entries = attributes
    .map((attribute) => `    ${indexCode(table, attribute)},`)
    .join("\n")
  if (source.includes("  (table) => [\n")) {
    return source.replace("  (table) => [\n", `  (table) => [\n${entries}\n`)
  }
  if (!source.includes("\n  }\n)\n")) {
    return fail(table, "cannot find the end of the column list")
  }
  return source.replace(
    "\n  }\n)\n",
    `\n  },\n  (table) => [\n${entries}\n  ]\n)\n`
  )
}

const addColumns = (edit: ModelEdit): string => {
  const { provider, table, add } = edit
  let source = edit.source
  const anchor = "    createdAt: "
  if (!source.includes(anchor)) {
    return fail(table, 'cannot find the "createdAt" column')
  }
  const columns = add.map((attribute) => ({
    attribute,
    ...columnCode(provider, table, attribute),
  }))
  const lines = columns
    .map((column) => `    ${column.attribute.name}: ${column.code},`)
    .join("\n")
  source = source.replace(anchor, `${lines}\n${anchor}`)
  const imports = columns.flatMap((column) => column.imports)
  if (add.some((attribute) => attribute.index)) {
    imports.push("index")
  }
  source = mergeImport(source, CORE_MODULE[provider], imports)
  for (const attribute of add) {
    if (attribute.type === "references" && attribute.references !== undefined) {
      const ref = attribute.references
      source = source.replace(
        /^(import \{[^}]+\} from "drizzle-orm\/[a-z]+-core"\n)/m,
        `$1import { ${camelCase(ref)} } from "./${kebabCase(ref)}"\n`
      )
    }
    if (attribute.type === "enum" && provider === "postgres") {
      const { variable, sqlName } = enumName(table, attribute)
      const values = (attribute.values ?? []).map(quoteLiteral).join(", ")
      const declaration = `const ${variable} = pgEnum("${sqlName}", [${values}])\n\n`
      const tableLine = `const ${camelCase(table)} = pgTable(`
      if (!source.includes(tableLine)) {
        return fail(table, `cannot find "${tableLine}"`)
      }
      source = source.replace(tableLine, `${declaration}${tableLine}`)
      source = addExport(source, variable)
    }
  }
  return addIndexes(
    source,
    table,
    add.filter((attribute) => attribute.index)
  )
}

const removeColumns = (edit: ModelEdit): string => {
  const { provider, table, remove } = edit
  let source = edit.source
  for (const attribute of remove) {
    const line = new RegExp(`^    ${attribute.name}: .*\\n`, "m")
    if (!line.test(source)) {
      return fail(table, `column "${attribute.name}" not found`)
    }
    source = source.replace(line, "")
    source = source.replace(
      new RegExp(
        `^    ${indexCode(table, attribute).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},\\n`,
        "m"
      ),
      ""
    )
    if (attribute.type === "enum" && provider === "postgres") {
      const { variable } = enumName(table, attribute)
      source = source.replace(
        new RegExp(`^const ${variable} = pgEnum\\(.*\\)\\n\\n`, "m"),
        ""
      )
      source = source.replace(
        new RegExp(`(export \\{[^}]*?)\\b${variable}, `),
        "$1"
      )
      source = source.replace(
        new RegExp(`(export \\{[^}]*?), ${variable} \\}`),
        "$1 }"
      )
    }
  }
  return source
    .replace("  (table) => [\n  ]\n)", "  }\n)")
    .replace("  },\n  }\n)", "  }\n)")
}

/** Applies the add and remove lists to the model source and returns the new text. */
const editModelSource = (edit: ModelEdit): string => {
  const added = edit.add.length > 0 ? addColumns(edit) : edit.source
  return edit.remove.length > 0
    ? removeColumns({ ...edit, source: added })
    : added
}

export type { ModelEdit }
export { editModelSource }
