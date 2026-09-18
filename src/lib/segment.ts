/**
 * Parser for App Router segment paths given to the route generators, e.g.
 * `posts/[id]/comments`, `(marketing)` or `api/posts`. Route groups are
 * kept in the directory but dropped from the URL. Dynamic parts become
 * typed `params`.
 */
import { WeeError } from "../core/errors.js"
import { kebabCase, pascalCase, singular, titleCase } from "./inflect.js"

type ParamKind = "single" | "catch-all" | "optional-catch-all"

interface SegmentParam {
  name: string
  kind: ParamKind
}

type SegmentPart =
  | { kind: "static"; value: string }
  | { kind: "group"; value: string }
  | { kind: "param"; param: SegmentParam }

interface Segment {
  /** The path as given, without surrounding slashes. */
  raw: string
  /** Directory under `app/`, e.g. `posts/[id]/comments`. Empty for the root. */
  dir: string
  /** URL pattern with groups removed, e.g. `/posts/[id]/comments`. */
  url: string
  /** Static URL prefix before the first param, e.g. `/posts`. */
  staticUrl: string
  parts: SegmentPart[]
  params: SegmentParam[]
  /** Human title, e.g. `Comments` or `Post` for `posts/[id]`. */
  title: string
  /** PascalCase singular of the last static part, e.g. `Post`. */
  modelName: string
  /** kebab-case identifier for manifests and markers, e.g. `posts-id-comments`. */
  key: string
}

const STATIC = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const GROUP = /^\(([A-Za-z0-9][A-Za-z0-9._-]*)\)$/
const PARAM = /^\[(\[)?(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)(\])?\]$/

const parsePart = (part: string, raw: string): SegmentPart => {
  if (STATIC.test(part)) {
    return { kind: "static", value: part }
  }
  const group = part.match(GROUP)
  if (group?.[1] !== undefined) {
    return { kind: "group", value: group[1] }
  }
  const param = part.match(PARAM)
  if (param?.[3] !== undefined) {
    const doubleOpen = param[1] !== undefined
    const doubleClose = param[4] !== undefined
    const spread = param[2] !== undefined
    if (doubleOpen !== doubleClose || (doubleOpen && !spread)) {
      throw new WeeError(
        "invalid-segment",
        `${raw}: "${part}" is not a valid dynamic segment. Use [name], [...name] or [[...name]].`
      )
    }
    const kind: ParamKind = doubleOpen
      ? "optional-catch-all"
      : spread
        ? "catch-all"
        : "single"
    return { kind: "param", param: { name: param[3], kind } }
  }
  throw new WeeError(
    "invalid-segment",
    `${raw}: "${part}" is not a valid segment. Use letters, digits, "-", "_", (group) or [param].`
  )
}

const parseSegment = (input: string): Segment => {
  const raw = input.trim().replace(/^\/+|\/+$/g, "")
  const parts =
    raw.length === 0 ? [] : raw.split("/").map((part) => parsePart(part, raw))
  const params = parts.flatMap((part) =>
    part.kind === "param" ? [part.param] : []
  )
  const urlParts = parts.filter((part) => part.kind !== "group")
  const firstParam = urlParts.findIndex((part) => part.kind === "param")
  const staticParts = (
    firstParam === -1 ? urlParts : urlParts.slice(0, firstParam)
  ).map((part) => (part.kind === "static" ? part.value : ""))
  const statics = parts.flatMap((part) =>
    part.kind === "static" ? [part.value] : []
  )
  const lastStatic = statics.at(-1)
  const last = parts.at(-1)
  const title =
    lastStatic === undefined
      ? "Home"
      : last?.kind === "param"
        ? titleCase(singular(lastStatic))
        : titleCase(lastStatic)
  return {
    raw,
    dir: parts.map(partSource).join("/"),
    url: `/${urlParts.map(partSource).join("/")}`,
    staticUrl: `/${staticParts.join("/")}`.replace(/\/$/, "") || "/",
    parts,
    params,
    title,
    modelName: pascalCase(singular(lastStatic ?? "page")),
    key: raw.length === 0 ? "root" : kebabCase(raw),
  }
}

const partSource = (part: SegmentPart): string => {
  switch (part.kind) {
    case "static":
      return part.value
    case "group":
      return `(${part.value})`
    case "param": {
      const { name, kind } = part.param
      if (kind === "single") {
        return `[${name}]`
      }
      return kind === "catch-all" ? `[...${name}]` : `[[...${name}]]`
    }
  }
}

/** Type of one param: `string`, `string[]` or optional `string[]`. */
const PARAM_TYPES: Record<ParamKind, (name: string) => string> = {
  single: (name) => `${name}: string`,
  "catch-all": (name) => `${name}: string[]`,
  "optional-catch-all": (name) => `${name}?: string[]`,
}

/** TypeScript object type for the segment's params, e.g. `{ id: string; slug: string[] }`. */
const paramsType = (params: SegmentParam[]): string => {
  const fields = params.map((param) => PARAM_TYPES[param.kind](param.name))
  return `{ ${fields.join("; ")} }`
}

export type { ParamKind, Segment, SegmentParam, SegmentPart }
export { paramsType, parseSegment }
