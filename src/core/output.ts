/**
 * Rendering for command results. `--json` prints one JSON document on
 * stdout. Otherwise rows render as an aligned table and errors as one line.
 */
import { styleText } from "node:util"
import { isWeeError } from "./errors.js"

type Row = Record<string, unknown>

const cell = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ""
  }
  if (Array.isArray(value)) {
    return value.map(cell).join(", ")
  }
  return String(value)
}

const renderTable = (rows: Row[]): string => {
  const first = rows[0]
  if (first === undefined) {
    return ""
  }
  const columns = Object.keys(first)
  const widths = columns.map((column) => {
    return Math.max(
      column.length,
      ...rows.map((row) => cell(row[column]).length)
    )
  })
  const line = (values: string[]): string => {
    return values
      .map((value, index) => value.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd()
  }
  const header = line(columns)
  const body = rows.map((row) =>
    line(columns.map((column) => cell(row[column])))
  )
  return [styleText("bold", header), ...body].join("\n")
}

interface EmitOptions {
  json: boolean
  data: Row[] | Row
  /** Optional line printed before a table in human mode. */
  title?: string
}

const emit = (options: EmitOptions): void => {
  const { json, data, title } = options
  if (json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
    return
  }
  if (title !== undefined) {
    process.stdout.write(`${title}\n`)
  }
  const rows = Array.isArray(data)
    ? data
    : Object.entries(data).map(([key, value]) => ({ key, value }))
  if (rows.length > 0) {
    process.stdout.write(`${renderTable(rows)}\n`)
  }
}

/** Prints an error and returns the exit code the process should use. */
const reportError = (error: unknown, json: boolean): number => {
  const code = isWeeError(error) ? error.code : "unexpected"
  const message = error instanceof Error ? error.message : String(error)
  const data = isWeeError(error) ? error.data : undefined
  const exitCode = isWeeError(error) ? error.exitCode : 1
  if (json) {
    process.stderr.write(
      `${JSON.stringify({ error: { code, message, data } })}\n`
    )
  } else {
    process.stderr.write(`${styleText("red", "error")} ${message}\n`)
    if (data !== undefined) {
      process.stderr.write(`${JSON.stringify(data)}\n`)
    }
  }
  return exitCode
}

export type { Row }
export { emit, renderTable, reportError }
