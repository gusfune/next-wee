/**
 * `wee stats`: lines of code by primitive and the test-to-code ratio.
 * A line counts as code when it is not blank and not a pure comment line.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CommandResult } from "../core/command.js"
import { defineWeeCommand } from "../core/command.js"
import { assertAppRouter } from "../core/context.js"
import type { Primitive } from "../lib/primitives.js"
import {
  classifyPrimitive,
  listSourceFiles,
  PRIMITIVE_ORDER,
  sourceRelative,
  TEST_PRIMITIVES,
} from "../lib/primitives.js"

type Count = {
  files: number
  lines: number
  loc: number
}

type StatsRow = Count & {
  primitive: string
}

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/

/** Lines that carry code: not blank, not a whole-line comment. */
const isCodeLine = (line: string): boolean =>
  line.trim().length > 0 && !COMMENT_LINE.test(line)

const countLines = (content: string): Omit<Count, "files"> => {
  const lines = content.split("\n")
  // A trailing newline yields one empty last element; it is not a line.
  if (lines.at(-1) === "") {
    lines.pop()
  }
  return { lines: lines.length, loc: lines.filter(isCodeLine).length }
}

const emptyCount = (): Count => ({ files: 0, lines: 0, loc: 0 })

/** Ratio `1:x` with one decimal; `1:0` when there is no code. */
const formatRatio = (code: number, tests: number): string =>
  `1:${code === 0 ? 0 : Math.round((tests / code) * 10) / 10}`

const stats = defineWeeCommand({
  meta: {
    name: "stats",
    description: "Lines of code by primitive and the test-to-code ratio",
  },
  run: async (ctx): Promise<CommandResult> => {
    assertAppRouter(ctx)
    const counts = new Map<Primitive, Count>()
    // O(files × lines): every source file is read once.
    for (const path of await listSourceFiles(ctx)) {
      const primitive = classifyPrimitive(sourceRelative(ctx, path))
      if (primitive === undefined) {
        continue
      }
      const count = counts.get(primitive) ?? emptyCount()
      const counted = countLines(
        readFileSync(join(ctx.target.path, path), "utf8")
      )
      counts.set(primitive, {
        files: count.files + 1,
        lines: count.lines + counted.lines,
        loc: count.loc + counted.loc,
      })
    }
    const rows = PRIMITIVE_ORDER.flatMap((primitive) => {
      const count = counts.get(primitive)
      return count === undefined ? [] : [{ primitive, ...count }]
    })
    const total = rows.reduce<Count>(
      (sum, row) => ({
        files: sum.files + row.files,
        lines: sum.lines + row.lines,
        loc: sum.loc + row.loc,
      }),
      emptyCount()
    )
    const tests = rows
      .filter((row) => TEST_PRIMITIVES.includes(row.primitive))
      .reduce((sum, row) => sum + row.loc, 0)
    const code = total.loc - tests
    const ratio = formatRatio(code, tests)
    const primitives: StatsRow[] = [...rows, { primitive: "total", ...total }]
    if (ctx.flags.json) {
      return { data: { primitives, code, tests, ratio } }
    }
    return {
      title: `code ${code} · tests ${tests} · ratio ${ratio}`,
      data: primitives,
    }
  },
})

export { stats }
