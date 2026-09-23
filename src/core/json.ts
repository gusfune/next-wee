/** Reads JSON files the user can edit by hand, with a stable error code for each file kind. */
import { readFileSync } from "node:fs"
import { z } from "zod"
import { WeeError } from "./errors.js"

/**
 * Parses `file` and validates it with `schema`. Malformed JSON and a schema
 * mismatch both fail with `code`, so `--json` callers see which file broke.
 */
const readJsonFile = <T extends z.ZodType>(
  file: string,
  schema: T,
  code: string
): z.output<T> => {
  const text = readFileSync(file, "utf8")
  const json = ((): unknown => {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new WeeError(code, `Cannot parse ${file}: ${String(error)}`)
    }
  })()
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new WeeError(
      code,
      `Invalid ${file}: ${z.prettifyError(result.error)}`
    )
  }
  return result.data
}

export { readJsonFile }
