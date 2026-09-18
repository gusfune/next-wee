/**
 * `wee notes`: `TODO`, `FIXME` and `OPTIMISE` annotations with file and
 * line, over the source files and the Markdown files at the app root.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { glob } from "tinyglobby"
import { defineWeeCommand } from "../core/command.js"
import { assertAppRouter } from "../core/context.js"
import { listSourceFiles } from "../lib/primitives.js"

type Note = {
  file: string
  line: number
  tag: string
  text: string
}

const ANNOTATION = /\b(TODO|FIXME|OPTIMI[SZ]E)\b:?\s*(.*)$/

/** Remainder of the line without a closing comment token. */
const cleanText = (raw: string): string =>
  raw
    .trim()
    .replace(/(\*\/|-->)\s*$/, "")
    .trim()

/** Code-point order on the path, then line number. Matches `sort` on the shell. */
const byFileThenLine = (a: Note, b: Note): number => {
  if (a.file !== b.file) {
    return a.file < b.file ? -1 : 1
  }
  return a.line - b.line
}

const notesIn = (file: string, content: string): Note[] => {
  const notes: Note[] = []
  const lines = content.split("\n")
  for (const [index, line] of lines.entries()) {
    const match = ANNOTATION.exec(line)
    if (match?.[1] !== undefined) {
      notes.push({
        file,
        line: index + 1,
        tag: match[1],
        text: cleanText(match[2] ?? ""),
      })
    }
  }
  return notes
}

const notes = defineWeeCommand({
  meta: {
    name: "notes",
    description: "List TODO, FIXME and OPTIMISE annotations",
  },
  run: async (ctx) => {
    assertAppRouter(ctx)
    const markdown = await glob(["*.md"], { cwd: ctx.target.path })
    const files = [...(await listSourceFiles(ctx)), ...markdown.sort()]
    // O(files × lines): every file is read once and scanned line by line.
    const found = files.flatMap((file) =>
      notesIn(file, readFileSync(join(ctx.target.path, file), "utf8"))
    )
    found.sort((a, b) => byFileThenLine(a, b))
    if (found.length === 0) {
      return { title: "no annotations", data: [] }
    }
    return { data: found }
  },
})

export { notes }
