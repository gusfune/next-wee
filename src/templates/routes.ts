/**
 * Templates for the route generators: page, loading, error, layout, route
 * handler, sitemap and Open Graph image. Params follow Next.js 15+, where
 * `params` is a Promise.
 */
import type { Segment } from "../lib/segment.js"
import { paramsType } from "../lib/segment.js"

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const

type HttpMethod = (typeof HTTP_METHODS)[number]

const BODY_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH"])

const isHttpMethod = (value: string): value is HttpMethod =>
  (HTTP_METHODS as readonly string[]).includes(value)

/** `const { id } = await params` for a segment with params, else nothing. */
const awaitParams = (segment: Segment): string[] => {
  if (segment.params.length === 0) {
    return []
  }
  const names = segment.params.map((param) => param.name).join(", ")
  return [`  const { ${names} } = await params`]
}

const pageTemplate = (segment: Segment): string => {
  const hasParams = segment.params.length > 0
  const lines: string[] = [
    `/** Page for ${segment.url}. */`,
    'import type { Metadata } from "next"',
    "",
  ]
  if (hasParams) {
    lines.push(
      "interface PageProps {",
      `  params: Promise<${paramsType(segment.params)}>`,
      "}",
      ""
    )
  }
  lines.push(
    `const metadata: Metadata = { title: "${segment.title}" }`,
    "",
    hasParams
      ? "const Page = async ({ params }: PageProps) => {"
      : "const Page = () => {",
    ...awaitParams(segment),
    "  return (",
    "    <main>",
    `      <h1>${segment.title}</h1>`,
    ...segment.params.map(
      (param) =>
        `      <p>${param.name}: {${param.kind === "single" ? param.name : `${param.name}?.join("/")`}}</p>`
    ),
    "    </main>",
    "  )",
    "}",
    "",
    "export { metadata }",
    "export default Page",
    ""
  )
  return lines.join("\n")
}

const loadingTemplate = (segment: Segment): string =>
  `/** Suspense fallback for ${segment.url}. */
const Loading = () => <p aria-busy="true">Loading…</p>

export default Loading
`

const errorTemplate = (segment: Segment): string =>
  `"use client"
/** Error boundary for ${segment.url}. Next.js passes the error and a reset callback. */
interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

const ErrorBoundary = ({ error, reset }: ErrorProps) => (
  <main>
    <h1>Something went wrong</h1>
    <p>{error.message}</p>
    <button type="button" onClick={reset}>
      Try again
    </button>
  </main>
)

export default ErrorBoundary
`

const layoutTemplate = (segment: Segment): string => {
  const hasParams = segment.params.length > 0
  const lines: string[] = [
    `/** Layout for ${segment.url}. */`,
    'import type { ReactNode } from "react"',
    "",
    "interface LayoutProps {",
    "  children: ReactNode",
    ...(hasParams ? [`  params: Promise<${paramsType(segment.params)}>`] : []),
    "}",
    "",
    hasParams
      ? "const Layout = async ({ children, params }: LayoutProps) => {"
      : "const Layout = ({ children }: LayoutProps) => {",
    ...awaitParams(segment),
    "  return (",
    `    <section${hasParams ? ` data-${segment.params[0]?.name}={${segment.params[0]?.name}}` : ""}>`,
    "      {children}",
    "    </section>",
    "  )",
    "}",
    "",
    "export default Layout",
    "",
  ]
  return lines.join("\n")
}

interface HandlerOptions {
  segment: Segment
  methods: HttpMethod[]
}

const handlerMethod = (method: HttpMethod, segment: Segment): string[] => {
  const hasParams = segment.params.length > 0
  const context = hasParams ? ", { params }: RouteContext" : ""
  const request = BODY_METHODS.has(method) ? "request" : "_request"
  const args =
    hasParams || BODY_METHODS.has(method)
      ? `${request}: NextRequest${context}`
      : ""
  const lines = [
    `const ${method} = async (${args}): Promise<NextResponse> => {`,
  ]
  lines.push(...awaitParams(segment))
  const paramsObject = hasParams
    ? `{ ${segment.params.map((param) => param.name).join(", ")} }`
    : "{}"
  if (BODY_METHODS.has(method)) {
    lines.push(
      "  const json: unknown = await request.json().catch(() => undefined)",
      "  const body = bodySchema.safeParse(json)",
      "  if (!body.success) {",
      "    return NextResponse.json(",
      "      { errors: z.flattenError(body.error).fieldErrors },",
      "      { status: 400 }",
      "    )",
      "  }",
      hasParams
        ? `  return NextResponse.json({ ...${paramsObject}, ...body.data }${method === "POST" ? ", { status: 201 }" : ""})`
        : `  return NextResponse.json(body.data${method === "POST" ? ", { status: 201 }" : ""})`
    )
  } else if (method === "DELETE") {
    lines.push("  return new NextResponse(null, { status: 204 })")
  } else if (method === "HEAD" || method === "OPTIONS") {
    lines.push("  return new NextResponse(null, { status: 200 })")
  } else {
    lines.push(`  return NextResponse.json(${paramsObject})`)
  }
  lines.push("}", "")
  return lines
}

const handlerTemplate = (options: HandlerOptions): string => {
  const { segment, methods } = options
  const hasParams = segment.params.length > 0
  const hasBody = methods.some((method) => BODY_METHODS.has(method))
  const needsRequest = hasParams || hasBody
  const lines: string[] = [`/** HTTP handlers for ${segment.url}. */`]
  if (needsRequest) {
    lines.push('import type { NextRequest } from "next/server"')
  }
  lines.push('import { NextResponse } from "next/server"')
  if (hasBody) {
    lines.push('import { z } from "zod"')
  }
  lines.push("")
  if (hasParams) {
    lines.push(
      "interface RouteContext {",
      `  params: Promise<${paramsType(segment.params)}>`,
      "}",
      ""
    )
  }
  if (hasBody) {
    lines.push(
      "/** Request body for the write methods. Add the fields the route accepts. */",
      "const bodySchema = z.object({})",
      ""
    )
  }
  for (const method of methods) {
    lines.push(...handlerMethod(method, segment))
  }
  lines.push(`export { ${methods.join(", ")} }`, "")
  return lines.join("\n")
}

/** Params literal for the test, e.g. `{ id: "1", slug: ["a", "b"] }`. */
const testParams = (segment: Segment): string =>
  `{ ${segment.params
    .map((param) =>
      param.kind === "single"
        ? `${param.name}: "1"`
        : `${param.name}: ["a", "b"]`
    )
    .join(", ")} }`

/** Expected status of one handler call: the success status per method. */
const successStatus = (method: HttpMethod): number => {
  if (method === "POST") {
    return 201
  }
  if (method === "DELETE") {
    return 204
  }
  return 200
}

const handlerTestTemplate = (options: HandlerOptions): string => {
  const { segment, methods } = options
  const hasParams = segment.params.length > 0
  const hasBody = methods.some((method) => BODY_METHODS.has(method))
  const needsStub = hasParams || hasBody
  const context = hasParams
    ? `, { params: Promise.resolve(${testParams(segment)}) }`
    : ""
  const call = (method: HttpMethod, body?: string): string =>
    hasParams || BODY_METHODS.has(method)
      ? `${method}(nextRequest(${body ?? ""})${context})`
      : `${method}()`
  const lines: string[] = ['import { describe, expect, it } from "vitest"']
  if (needsStub) {
    lines.push('import type { NextRequest } from "next/server"')
  }
  lines.push(`import { ${methods.join(", ")} } from "./route"`, "")
  if (needsStub) {
    lines.push(
      "const nextRequest = (body?: unknown): NextRequest =>",
      "  ({ json: () => Promise.resolve(body) }) as NextRequest",
      ""
    )
  }
  for (const method of methods) {
    const cases: string[] = []
    if (BODY_METHODS.has(method)) {
      cases.push(
        `  it("rejects an invalid body", async () => {`,
        `    const response = await ${call(method, "null")}`,
        `    expect(response.status).toBe(400)`,
        `  })`,
        ""
      )
    }
    cases.push(
      `  it("answers ${successStatus(method)}", async () => {`,
      `    const response = await ${BODY_METHODS.has(method) ? call(method, "{}") : call(method)}`,
      `    expect(response.status).toBe(${successStatus(method)})`,
      `  })`
    )
    lines.push(
      `describe("${method} ${segment.url}", () => {`,
      ...cases,
      "})",
      ""
    )
  }
  return lines.join("\n")
}

const sitemapTemplate = (segment: Segment): string =>
  `/** Sitemap for ${segment.staticUrl}. Add one entry per public URL. */
import type { MetadataRoute } from "next"

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

const sitemap = async (): Promise<MetadataRoute.Sitemap> => [
  { url: \`\${baseUrl}${segment.staticUrl === "/" ? "" : segment.staticUrl}\`, lastModified: new Date() },
]

export default sitemap
`

const ogImageTemplate = (segment: Segment): string => {
  const hasParams = segment.params.length > 0
  const lines: string[] = [
    `/** Open Graph image for ${segment.url}. Rendered on the edge by next/og. */`,
    'import { ImageResponse } from "next/og"',
    "",
  ]
  if (hasParams) {
    lines.push(
      "interface ImageProps {",
      `  params: Promise<${paramsType(segment.params)}>`,
      "}",
      ""
    )
  }
  lines.push(
    `const alt = "${segment.title}"`,
    "const size = { width: 1200, height: 630 }",
    'const contentType = "image/png"',
    "",
    hasParams
      ? "const Image = async ({ params }: ImageProps) => {"
      : "const Image = () => {",
    ...awaitParams(segment),
    "  return new ImageResponse(",
    "    <div",
    "      style={{",
    "        width: '100%',",
    "        height: '100%',",
    "        display: 'flex',",
    "        alignItems: 'center',",
    "        justifyContent: 'center',",
    "        fontSize: 96,",
    "        background: 'white',",
    "      }}",
    "    >",
    hasParams
      ? `      ${segment.title} {${segment.params[0]?.name}}`
      : `      ${segment.title}`,
    "    </div>,",
    "    size",
    "  )",
    "}",
    "",
    "export { alt, contentType, size }",
    "export default Image",
    ""
  )
  return lines.join("\n")
}

export type { HttpMethod }
export {
  BODY_METHODS,
  errorTemplate,
  HTTP_METHODS,
  handlerTemplate,
  handlerTestTemplate,
  isHttpMethod,
  layoutTemplate,
  loadingTemplate,
  ogImageTemplate,
  pageTemplate,
  sitemapTemplate,
}
