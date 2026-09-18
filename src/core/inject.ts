/**
 * Marker-based injection into existing files. A block sits between
 * `wee:begin <id>` and `wee:end <id>` comment lines so `destroy` can remove
 * it without an AST. The comment style follows the file extension.
 */
import { extname } from "node:path"

interface CommentStyle {
  open: string
  close: string
}

const COMMENT_STYLES: Record<string, CommentStyle> = {
  ".md": { open: "<!-- ", close: " -->" },
  ".mdx": { open: "<!-- ", close: " -->" },
  ".html": { open: "<!-- ", close: " -->" },
  ".yaml": { open: "# ", close: "" },
  ".yml": { open: "# ", close: "" },
  ".env": { open: "# ", close: "" },
  ".toml": { open: "# ", close: "" },
  ".example": { open: "# ", close: "" },
  ".gitignore": { open: "# ", close: "" },
  ".css": { open: "/* ", close: " */" },
}

const DEFAULT_STYLE: CommentStyle = { open: "// ", close: "" }

const styleFor = (path: string): CommentStyle => {
  const base = path.split(/[\\/]/).at(-1) ?? path
  const ext = extname(base) || base
  return COMMENT_STYLES[ext] ?? DEFAULT_STYLE
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

interface MarkerLines {
  begin: string
  end: string
}

const markerLines = (path: string, id: string): MarkerLines => {
  const style = styleFor(path)
  return {
    begin: `${style.open}wee:begin ${id}${style.close}`,
    end: `${style.open}wee:end ${id}${style.close}`,
  }
}

const wrapBlock = (path: string, id: string, content: string): string => {
  const { begin, end } = markerLines(path, id)
  const body = content.replace(/\n+$/, "")
  return `${begin}\n${body}\n${end}\n`
}

interface InjectOptions {
  source: string
  path: string
  id: string
  content: string
  /** Insert after the last line that contains this text. Appends when absent. */
  after?: string | undefined
}

/** Whole-line match, so `job-x` does not report `job-x-import` as present. */
const hasBlock = (source: string, path: string, id: string): boolean =>
  new RegExp(`^${escapeRegExp(markerLines(path, id).begin)}$`, "m").test(source)

const injectBlock = (options: InjectOptions): string => {
  const { source, path, id, content, after } = options
  if (hasBlock(source, path, id)) {
    return replaceBlock(options)
  }
  const block = wrapBlock(path, id, content)
  if (after !== undefined) {
    const lines = source.split("\n")
    const index = lines.findLastIndex((line) => line.includes(after))
    if (index >= 0) {
      lines.splice(index + 1, 0, block.replace(/\n$/, ""))
      return lines.join("\n")
    }
  }
  const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n"
  return `${source}${separator}${block}`
}

const blockPattern = (path: string, id: string): RegExp => {
  const { begin, end } = markerLines(path, id)
  return new RegExp(
    `${escapeRegExp(begin)}\\n[\\s\\S]*?${escapeRegExp(end)}\\n?`
  )
}

const replaceBlock = (options: InjectOptions): string => {
  const { source, path, id, content } = options
  return source.replace(blockPattern(path, id), wrapBlock(path, id, content))
}

const removeBlock = (source: string, path: string, id: string): string => {
  return source.replace(blockPattern(path, id), "")
}

/** Returns the text between the markers, or undefined when the block is absent. */
const readBlock = (
  source: string,
  path: string,
  id: string
): string | undefined => {
  const { begin, end } = markerLines(path, id)
  const match = source.match(
    new RegExp(`${escapeRegExp(begin)}\\n([\\s\\S]*?)${escapeRegExp(end)}`)
  )
  return match?.[1]
}

export { hasBlock, injectBlock, markerLines, readBlock, removeBlock }
