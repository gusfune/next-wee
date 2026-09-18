/**
 * Templates for `wee g resource`: the four CRUD pages, the display helper,
 * the nav component with its link block, and the Playwright e2e flow.
 * Every page gets its imports precomputed by the generator, so the
 * templates stay free of path logic.
 */
import type { Attribute, ModelSpec } from "../core/adapters.js"
import { camelCase, kebabCase, plural, titleCase } from "../lib/inflect.js"

/** The attribute a row is shown by: first string, else first attribute. */
const displayAttribute = (model: ModelSpec): Attribute | undefined =>
  model.attributes.find((attribute) => attribute.type === "string") ??
  model.attributes[0]

/** Names one resource is built from, e.g. `Post`, `post`, `posts`, `/posts`. */
interface ResourceNames {
  name: string
  entity: string
  title: string
  titles: string
  url: string
}

const resourceNames = (model: ModelSpec): ResourceNames => {
  const names = plural(model.name)
  return {
    name: model.name,
    entity: camelCase(model.name),
    title: titleCase(model.name).toLowerCase(),
    titles: titleCase(names),
    url: `/${kebabCase(names)}`,
  }
}

/** JSX expression that renders the row's display value. */
const displayExpression = (model: ModelSpec, entity: string): string => {
  const attribute = displayAttribute(model)
  if (attribute === undefined) {
    return `{${entity}.id}`
  }
  if (attribute.type === "string") {
    return attribute.optional
      ? `{${entity}.${attribute.name} ?? ${entity}.id}`
      : `{${entity}.${attribute.name}}`
  }
  return `{displayValue(${entity}.${attribute.name})}`
}

const usesDisplayValue = (model: ModelSpec): boolean => {
  const attribute = displayAttribute(model)
  return attribute !== undefined && attribute.type !== "string"
}

interface ResourceImports {
  /** Relative import of the form component. */
  form: string
  /** Relative import of the segment's `actions.ts`. */
  actions: string
  /** Relative import of the model's service. */
  service: string
  /** Relative import of the model's validator. */
  validator: string
  /** Relative import of `lib/display`. */
  display: string
}

interface ResourcePageOptions {
  model: ModelSpec
  imports: ResourceImports
}

const listPageTemplate = (options: ResourcePageOptions): string => {
  const { model, imports } = options
  const { name, entity, title, titles, url } = resourceNames(model)
  const lines: string[] = [
    `/** List page for ${url}. Paginated through searchParams. */`,
    'import type { Metadata } from "next"',
    'import Link from "next/link"',
    ...(usesDisplayValue(model)
      ? [`import { displayValue } from "${imports.display}"`]
      : []),
    `import { ${entity}QuerySchema } from "${imports.validator}"`,
    `import { list${plural(name)} } from "${imports.service}"`,
    `import { remove${name} } from "${imports.actions}"`,
    "",
    "interface PageProps {",
    "  searchParams: Promise<Record<string, string | string[] | undefined>>",
    "}",
    "",
    `const metadata: Metadata = { title: "${titles}" }`,
    "",
    "const Page = async ({ searchParams }: PageProps) => {",
    `  const parsed = ${entity}QuerySchema.safeParse(await searchParams)`,
    `  const query = parsed.success ? parsed.data : ${entity}QuerySchema.parse({})`,
    `  const { rows, total, page, perPage } = await list${plural(name)}(query)`,
    "  const pages = Math.max(1, Math.ceil(total / perPage))",
    "  return (",
    "    <main>",
    `      <h1>${titles}</h1>`,
    "      <p>",
    `        <Link href="${url}/new">New ${title}</Link>`,
    "      </p>",
    "      <ul>",
    `        {rows.map((${entity}) => (`,
    `          <li key={${entity}.id}>`,
    `            <Link href={\`${url}/\${${entity}.id}\`}>${displayExpression(model, entity)}</Link>{" "}`,
    `            <Link href={\`${url}/\${${entity}.id}/edit\`}>Edit</Link>{" "}`,
    `            <form action={remove${name}.bind(null, ${entity}.id)} style={{ display: "inline" }}>`,
    '              <button type="submit">Delete</button>',
    "            </form>",
    "          </li>",
    "        ))}",
    "      </ul>",
    '      <nav aria-label="Pagination">',
    `        {page > 1 ? <Link href={\`${url}?page=\${page - 1}\`}>Previous</Link> : null}{" "}`,
    "        <span>",
    "          Page {page} of {pages}",
    '        </span>{" "}',
    `        {page < pages ? <Link href={\`${url}?page=\${page + 1}\`}>Next</Link> : null}`,
    "      </nav>",
    "    </main>",
    "  )",
    "}",
    "",
    "export { metadata }",
    "export default Page",
    "",
  ]
  return lines.join("\n")
}

const newPageTemplate = (options: ResourcePageOptions): string => {
  const { model, imports } = options
  const { name, title, titles, url } = resourceNames(model)
  return [
    `/** New page for ${url}/new. */`,
    'import type { Metadata } from "next"',
    'import Link from "next/link"',
    `import { ${name}Form } from "${imports.form}"`,
    "",
    `const metadata: Metadata = { title: "New ${title}" }`,
    "",
    "const Page = () => (",
    "  <main>",
    `    <h1>New ${title}</h1>`,
    `    <${name}Form />`,
    "    <p>",
    `      <Link href="${url}">Back to ${titles.toLowerCase()}</Link>`,
    "    </p>",
    "  </main>",
    ")",
    "",
    "export { metadata }",
    "export default Page",
    "",
  ].join("\n")
}

const paramsBlock = [
  "interface PageProps {",
  "  params: Promise<{ id: string }>",
  "}",
  "",
]

const loadRecordLines = (name: string, entity: string): string[] => [
  "  const { id } = await params",
  `  const ${entity} = await get${name}(id)`,
  `  if (${entity} === undefined) {`,
  "    notFound()",
  "  }",
]

const showPageTemplate = (options: ResourcePageOptions): string => {
  const { model, imports } = options
  const { name, entity, title, titles, url } = resourceNames(model)
  const fields = [
    ...model.attributes.map((attribute) => ({
      label: titleCase(attribute.name),
      name: attribute.name,
    })),
    { label: "Created at", name: "createdAt" },
    { label: "Updated at", name: "updatedAt" },
  ]
  return [
    `/** Show page for ${url}/[id]. */`,
    'import type { Metadata } from "next"',
    'import Link from "next/link"',
    'import { notFound } from "next/navigation"',
    `import { displayValue } from "${imports.display}"`,
    `import { get${name} } from "${imports.service}"`,
    "",
    ...paramsBlock,
    `const metadata: Metadata = { title: "${titleCase(title)}" }`,
    "",
    "const Page = async ({ params }: PageProps) => {",
    ...loadRecordLines(name, entity),
    "  return (",
    "    <main>",
    `      <h1>${displayExpression(model, entity)}</h1>`,
    "      <dl>",
    ...fields.flatMap((field) => [
      `        <dt>${field.label}</dt>`,
      `        <dd>{displayValue(${entity}.${field.name})}</dd>`,
    ]),
    "      </dl>",
    "      <p>",
    `        <Link href={\`${url}/\${${entity}.id}/edit\`}>Edit</Link>{" "}`,
    `        <Link href="${url}">Back to ${titles.toLowerCase()}</Link>`,
    "      </p>",
    "    </main>",
    "  )",
    "}",
    "",
    "export { metadata }",
    "export default Page",
    "",
  ].join("\n")
}

const editPageTemplate = (options: ResourcePageOptions): string => {
  const { model, imports } = options
  const { name, entity, title, url } = resourceNames(model)
  return [
    `/** Edit page for ${url}/[id]/edit. */`,
    'import type { Metadata } from "next"',
    'import Link from "next/link"',
    'import { notFound } from "next/navigation"',
    `import { ${name}Form } from "${imports.form}"`,
    `import { get${name} } from "${imports.service}"`,
    "",
    ...paramsBlock,
    `const metadata: Metadata = { title: "Edit ${title}" }`,
    "",
    "const Page = async ({ params }: PageProps) => {",
    ...loadRecordLines(name, entity),
    "  return (",
    "    <main>",
    `      <h1>Edit ${title}</h1>`,
    `      <${name}Form ${entity}={${entity}} />`,
    "      <p>",
    `        <Link href={\`${url}/\${${entity}.id}\`}>Back</Link>`,
    "      </p>",
    "    </main>",
    "  )",
    "}",
    "",
    "export { metadata }",
    "export default Page",
    "",
  ].join("\n")
}

const displayLibTemplate =
  (): string => `/** Renders a column value as text for list and show pages. */
const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ""
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

export { displayValue }
`

const displayLibTestTemplate =
  (): string => `import { describe, expect, it } from "vitest"
import { displayValue } from "./display"

describe("displayValue", () => {
  it("renders every column type as text", () => {
    expect(displayValue(null)).toBe("")
    expect(displayValue(undefined)).toBe("")
    expect(displayValue(true)).toBe("Yes")
    expect(displayValue(false)).toBe("No")
    expect(displayValue(new Date("2024-01-01T00:00:00.000Z"))).toBe("2024-01-01T00:00:00.000Z")
    expect(displayValue({ key: "value" })).toBe('{"key":"value"}')
    expect(displayValue(1.5)).toBe("1.5")
    expect(displayValue("text")).toBe("text")
  })
})
`

/** Line the nav link blocks are inserted after. */
const NAV_ANCHOR = "const links: NavLink[] = ["

const navTemplate = (): string => `/**
 * Main navigation. \`wee g resource\` adds one link per resource between
 * markers; render \`<Nav />\` from the root layout.
 */
import Link from "next/link"

interface NavLink {
  href: string
  label: string
}

${NAV_ANCHOR}
]

const Nav = () => (
  <nav aria-label="Main">
    <ul>
      {links.map((link) => (
        <li key={link.href}>
          <Link href={link.href}>{link.label}</Link>
        </li>
      ))}
    </ul>
  </nav>
)

export type { NavLink }
export { Nav, links }
`

const navLinkBlock = (model: ModelSpec): string => {
  const { titles, url } = resourceNames(model)
  return `  { href: "${url}", label: "${titles}" },`
}

/** Value the e2e test types into one field, or undefined to leave it alone. */
const sampleValue = (
  attribute: Attribute,
  title: string
): string | undefined => {
  switch (attribute.type) {
    case "string":
      return title
    case "text":
      return "Sample text"
    case "integer":
      return "1"
    case "decimal":
      return "1.5"
    case "datetime":
      return "2024-01-01T00:00"
    case "uuid":
    case "references":
      return "00000000-0000-4000-8000-000000000000"
    case "json":
      return '{"key":"value"}'
    default:
      return undefined
  }
}

const fillLine = (attribute: Attribute, title: string): string[] => {
  const label = titleCase(attribute.name)
  if (attribute.type === "enum") {
    const first = attribute.values?.[0]
    return first === undefined
      ? []
      : [`  await page.getByLabel("${label}").selectOption("${first}")`]
  }
  const value = sampleValue(attribute, title)
  if (value === undefined) {
    return []
  }
  const expression = attribute.type === "string" ? "title" : `"${value}"`
  const note =
    attribute.type === "references"
      ? [
          `  // ${attribute.name} must point at an existing row; adjust before running.`,
        ]
      : []
  return [...note, `  await page.getByLabel("${label}").fill(${expression})`]
}

const e2eTemplate = (model: ModelSpec): string => {
  const { name, title, url } = resourceNames(model)
  const display = displayAttribute(model)
  const filled = model.attributes.filter(
    (attribute) => !attribute.optional || attribute === display
  )
  const displayIsString = display?.type === "string"
  // The row is found by its display text; a non-string display attribute
  // shows the typed sample value.
  const linkText =
    display === undefined
      ? "title"
      : displayIsString
        ? "title"
        : `"${sampleValue(display, "") ?? ""}"`
  const editedText = displayIsString ? `\`\${title} edited\`` : linkText
  const lines: string[] = [
    `/** End-to-end CRUD flow for ${url}. Generated by \`wee g resource ${name}\`. */`,
    'import { expect, test } from "@playwright/test"',
    "",
    `test("${title}: create, read, update, delete", async ({ page }) => {`,
    `  const title = \`${titleCase(name)} \${Date.now()}\``,
    `  await page.goto("${url}/new")`,
    ...filled.flatMap((attribute) => fillLine(attribute, "title")),
    '  await page.getByRole("button", { name: "Create" }).click()',
    `  await expect(page.getByRole("status")).toHaveText("${name} created.")`,
    "",
    `  await page.goto("${url}")`,
    `  await page.getByRole("link", { name: ${linkText} }).first().click()`,
    `  await expect(page.getByRole("heading", { level: 1 })).toContainText(${linkText})`,
    "",
    '  await page.getByRole("link", { name: "Edit" }).click()',
    ...(displayIsString && display !== undefined
      ? [
          `  await page.getByLabel("${titleCase(display.name)}").fill(${editedText})`,
        ]
      : []),
    '  await page.getByRole("button", { name: "Save" }).click()',
    `  await expect(page.getByRole("status")).toHaveText("${name} saved.")`,
    "",
    `  await page.goto("${url}")`,
    `  const row = page.getByRole("listitem").filter({ hasText: ${editedText} })`,
    '  await row.getByRole("button", { name: "Delete" }).click()',
    `  await expect(page.getByRole("link", { name: ${editedText} })).toHaveCount(0)`,
    "})",
    "",
  ]
  return lines.join("\n")
}

interface ApiImports {
  /** Relative import of the model's service. */
  service: string
  /** Relative import of the model's validator. */
  validator: string
}

interface ApiRouteOptions {
  model: ModelSpec
  imports: ApiImports
}

/** `GET` (list, paginated) and `POST` (create) for `app/api/<plural>/route.ts`. */
const apiCollectionTemplate = (options: ApiRouteOptions): string => {
  const { model, imports } = options
  const { name, entity, url } = resourceNames(model)
  const names = plural(name)
  return `/** HTTP handlers for /api${url}: list and create ${name.toLowerCase()} rows. */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { ${entity}QuerySchema, insert${name}Schema } from "${imports.validator}"
import { create${name}, list${names} } from "${imports.service}"

const GET = async (request: NextRequest): Promise<NextResponse> => {
  const parsed = ${entity}QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const query = parsed.success ? parsed.data : ${entity}QuerySchema.parse({})
  return NextResponse.json(await list${names}(query))
}

const POST = async (request: NextRequest): Promise<NextResponse> => {
  const json: unknown = await request.json().catch(() => undefined)
  const body = insert${name}Schema.safeParse(json)
  if (!body.success) {
    return NextResponse.json(
      { errors: z.flattenError(body.error).fieldErrors },
      { status: 400 }
    )
  }
  return NextResponse.json(await create${name}(body.data), { status: 201 })
}

export { GET, POST }
`
}

/** `GET`, `PATCH` and `DELETE` for one row in `app/api/<plural>/[id]/route.ts`. */
const apiMemberTemplate = (options: ApiRouteOptions): string => {
  const { model, imports } = options
  const { name, url } = resourceNames(model)
  return `/** HTTP handlers for /api${url}/[id]: show, update and delete one ${name.toLowerCase()}. */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { update${name}Schema } from "${imports.validator}"
import { get${name}, remove${name}, update${name} } from "${imports.service}"

interface RouteContext {
  params: Promise<{ id: string }>
}

const notFound = (): NextResponse =>
  NextResponse.json({ error: "${name} not found" }, { status: 404 })

const GET = async (
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> => {
  const { id } = await params
  const row = await get${name}(id)
  return row === undefined ? notFound() : NextResponse.json(row)
}

const PATCH = async (
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> => {
  const { id } = await params
  const json: unknown = await request.json().catch(() => undefined)
  const body = update${name}Schema.safeParse(json)
  if (!body.success) {
    return NextResponse.json(
      { errors: z.flattenError(body.error).fieldErrors },
      { status: 400 }
    )
  }
  const row = await update${name}(id, body.data)
  return row === undefined ? notFound() : NextResponse.json(row)
}

const DELETE = async (
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> => {
  const { id } = await params
  if ((await get${name}(id)) === undefined) {
    return notFound()
  }
  await remove${name}(id)
  return new NextResponse(null, { status: 204 })
}

export { DELETE, GET, PATCH }
`
}

export type {
  ApiImports,
  ApiRouteOptions,
  ResourceImports,
  ResourcePageOptions,
}
export {
  apiCollectionTemplate,
  apiMemberTemplate,
  displayAttribute,
  displayLibTemplate,
  displayLibTestTemplate,
  e2eTemplate,
  editPageTemplate,
  listPageTemplate,
  NAV_ANCHOR,
  navLinkBlock,
  navTemplate,
  newPageTemplate,
  showPageTemplate,
}
