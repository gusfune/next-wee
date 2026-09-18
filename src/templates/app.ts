/**
 * Templates for the app-level generators: env, proxy and action. These
 * three share one file each (`env.ts`, `proxy.ts`, `<segment>/actions.ts`)
 * that the first run creates with `ensure` and later runs extend with
 * marker blocks.
 */
import type { Attribute, ModelSpec } from "../core/adapters.js"
import { camelCase, kebabCase } from "../lib/inflect.js"
import type { Segment } from "../lib/segment.js"

/** Anchors the env blocks are injected after. */
const ENV_ANCHORS = {
  server: "const serverSchema = z.object({",
  client: "const clientSchema = z.object({",
  clientValues: "const clientEnv = clientSchema.parse({",
} as const

const envTemplate = (): string => `/**
 * Validated environment. Call \`serverEnv()\` in server code and read
 * \`clientEnv\` anywhere. \`wee g env\` adds one block per variable.
 */
import { z } from "zod"

${ENV_ANCHORS.server}
})

${ENV_ANCHORS.client}
})

/** Client variables are read one by one so Next.js can inline them. */
${ENV_ANCHORS.clientValues}
})

let cachedServerEnv: z.infer<typeof serverSchema> | undefined

/** Server variables. Parsed on first use so client bundles never load them. */
const serverEnv = (): z.infer<typeof serverSchema> => {
  cachedServerEnv ??= serverSchema.parse(process.env)
  return cachedServerEnv
}

export { clientEnv, serverEnv }
`

/** Anchors the proxy blocks are injected after. */
const PROXY_ANCHORS = {
  interceptors: "const interceptors: Interceptor[] = [",
  matcher: "  matcher: [",
} as const

const proxyTemplate = (): string => `/**
 * Request interception (the Next.js proxy). Each block is one interceptor;
 * \`wee g proxy <name>\` adds one. The first interceptor that returns a
 * response wins. \`config.matcher\` must stay a literal array so Next.js can
 * read it at build time.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

type Interceptor = (request: NextRequest) => NextResponse | undefined

${PROXY_ANCHORS.interceptors}
]

const proxy = (request: NextRequest): NextResponse => {
  for (const interceptor of interceptors) {
    const response = interceptor(request)
    if (response !== undefined) {
      return response
    }
  }
  return NextResponse.next()
}

const config = {
${PROXY_ANCHORS.matcher}
  ],
}

export { config, proxy }
`

/** Static prefix of a matcher, e.g. `/dashboard` for `/dashboard/:path*`. */
const matcherPrefix = (matcher: string): string => {
  const prefix = matcher.split(/[:(*]/)[0] ?? ""
  return prefix.replace(/\/+$/, "") || "/"
}

interface ProxyBlockOptions {
  name: string
  matchers: string[]
}

const proxyInterceptorBlock = (options: ProxyBlockOptions): string => {
  const { name, matchers } = options
  const prefixes = [...new Set(matchers.map(matcherPrefix))]
  const guard =
    prefixes.length === 1 && prefixes[0] === "/"
      ? []
      : [
          `    if (!${prefixes.map((prefix) => `request.nextUrl.pathname.startsWith("${prefix}")`).join(" && !")}) {`,
          "      return undefined",
          "    }",
        ]
  return [
    `  /** ${kebabCase(name)}: ${matchers.join(", ")}. Return a response to stop the chain. */`,
    `  (${guard.length === 0 ? "_request" : "request"}) => {`,
    ...guard,
    `    // ${kebabCase(name)}: add the check here, e.g. NextResponse.redirect(...) when it fails.`,
    "    return undefined",
    "  },",
  ].join("\n")
}

const proxyMatcherBlock = (matchers: string[]): string =>
  matchers.map((matcher) => `    "${matcher}",`).join("\n")

/** Shared helpers for server actions. Created once by the first `g action` or `g form`. */
const actionsLibTemplate = (): string => `/**
 * Shared shape for server actions used with \`useActionState\`, plus
 * readers that turn FormData fields into typed values.
 */

interface ActionState {
  status: "idle" | "success" | "error"
  message?: string
  /** Validation messages by field name. */
  errors?: Record<string, string[]>
}

const initialActionState: ActionState = { status: "idle" }

interface Issue {
  path: ReadonlyArray<PropertyKey>
  message: string
}

/** Error state from validation issues (Zod's shape), grouped by the first path segment. */
const invalid = (issues: ReadonlyArray<Issue>): ActionState => {
  const errors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form")
    errors[key] = [...(errors[key] ?? []), issue.message]
  }
  return { status: "error", message: "Check the highlighted fields.", errors }
}

const text = (data: FormData, name: string): string | undefined => {
  const value = data.get(name)
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Readers for FormData. Empty fields become undefined so optional fields validate. */
const form = {
  text,
  number: (data: FormData, name: string): number | undefined => {
    const value = text(data, name)
    return value === undefined ? undefined : Number(value)
  },
  /** Checkboxes send a value only when checked. */
  boolean: (data: FormData, name: string): boolean => data.get(name) !== null,
  date: (data: FormData, name: string): Date | undefined => {
    const value = text(data, name)
    return value === undefined ? undefined : new Date(value)
  },
  /** Parsed JSON, or the raw text when it does not parse so the validator reports it. */
  json: (data: FormData, name: string): unknown => {
    const value = text(data, name)
    if (value === undefined) {
      return undefined
    }
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  },
}

export type { ActionState }
export { form, initialActionState, invalid }
`

interface ActionsFileOptions {
  segment: Segment
  /** Relative import of `lib/actions`, e.g. `../../lib/actions`. */
  libImport: string
}

const actionsTemplate = (options: ActionsFileOptions): string => {
  const { segment, libImport } = options
  return `"use server"
/**
 * Server actions for ${segment.url}. Each block is one action;
 * \`wee g action ${segment.raw} <name>\` adds one. Actions validate input,
 * call a service and revalidate.
 */
import { revalidatePath } from "next/cache"
import type { ActionState } from "${libImport}"
import { form, invalid } from "${libImport}"
`
}

/** `form.<reader>(formData, "<name>")` for one attribute. */
const formReader = (attribute: Attribute): string => {
  const reader = ((): string => {
    switch (attribute.type) {
      case "integer":
      case "decimal":
        return "number"
      case "boolean":
        return "boolean"
      case "datetime":
        return "date"
      case "json":
        return "json"
      default:
        return "text"
    }
  })()
  return `form.${reader}(formData, "${attribute.name}")`
}

const inputLines = (model: ModelSpec): string[] => [
  "  const input = {",
  ...model.attributes.map(
    (attribute) => `    ${attribute.name}: ${formReader(attribute)},`
  ),
  "  }",
]

interface ModelActionOptions {
  segment: Segment
  model: ModelSpec
  /** Relative import of the validator, e.g. `../../lib/validators/post`. */
  validatorImport: string
  /** Relative import of the service, e.g. `../../services/posts`. */
  serviceImport: string
}

const createActionBlock = (options: ModelActionOptions): string => {
  const { segment, model, validatorImport, serviceImport } = options
  const name = model.name
  return [
    `import { insert${name}Schema } from "${validatorImport}"`,
    `import { create${name} as create${name}Record } from "${serviceImport}"`,
    "",
    `export const create${name} = async (`,
    "  _previous: ActionState,",
    "  formData: FormData",
    "): Promise<ActionState> => {",
    ...inputLines(model),
    `  const parsed = insert${name}Schema.safeParse(input)`,
    "  if (!parsed.success) {",
    "    return invalid(parsed.error.issues)",
    "  }",
    `  await create${name}Record(parsed.data)`,
    `  revalidatePath("${segment.staticUrl}")`,
    `  return { status: "success", message: "${name} created." }`,
    "}",
  ].join("\n")
}

const updateActionBlock = (options: ModelActionOptions): string => {
  const { segment, model, validatorImport, serviceImport } = options
  const name = model.name
  return [
    `import { update${name}Schema } from "${validatorImport}"`,
    `import { update${name} as update${name}Record } from "${serviceImport}"`,
    "",
    `export const update${name} = async (`,
    "  id: string,",
    "  _previous: ActionState,",
    "  formData: FormData",
    "): Promise<ActionState> => {",
    ...inputLines(model),
    `  const parsed = update${name}Schema.safeParse(input)`,
    "  if (!parsed.success) {",
    "    return invalid(parsed.error.issues)",
    "  }",
    `  await update${name}Record(id, parsed.data)`,
    `  revalidatePath("${segment.staticUrl}")`,
    `  return { status: "success", message: "${name} saved." }`,
    "}",
  ].join("\n")
}

const removeActionBlock = (options: ModelActionOptions): string => {
  const { segment, model, serviceImport } = options
  const name = model.name
  return [
    `import { remove${name} as remove${name}Record } from "${serviceImport}"`,
    "",
    `export const remove${name} = async (id: string): Promise<void> => {`,
    `  await remove${name}Record(id)`,
    `  revalidatePath("${segment.staticUrl}")`,
    "}",
  ].join("\n")
}

interface GenericActionOptions {
  segment: Segment
  /** camelCase action name, e.g. `publishPost`. */
  name: string
}

const genericActionBlock = (options: GenericActionOptions): string => {
  const { segment, name } = options
  return [
    `export const ${name} = async (`,
    "  _previous: ActionState,",
    "  formData: FormData",
    "): Promise<ActionState> => {",
    '  const id = form.text(formData, "id")',
    "  if (id === undefined) {",
    '    return invalid([{ path: ["id"], message: "Required" }])',
    "  }",
    `  revalidatePath("${segment.staticUrl}")`,
    `  return { status: "success", message: "${camelCase(name)} done." }`,
    "}",
  ].join("\n")
}

export {
  actionsLibTemplate,
  actionsTemplate,
  createActionBlock,
  ENV_ANCHORS,
  envTemplate,
  genericActionBlock,
  matcherPrefix,
  PROXY_ANCHORS,
  proxyInterceptorBlock,
  proxyMatcherBlock,
  proxyTemplate,
  removeActionBlock,
  updateActionBlock,
}
