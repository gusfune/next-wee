/** CONVENTIONS.md template. The CLI reads this file in the target app; humans and agents edit it. */
import type { AppConfig } from "../core/config.js"

const conventionsTemplate = (config: AppConfig): string => {
  const src = config.srcDir ? "src/" : ""
  return `# Conventions

This file is the source of truth for the \`wee\` CLI and for coding agents working in this app.
The CLI reads it before it generates code. Edit the values here, not the CLI.

## Layout

| Primitive | Location |
|---|---|
| model | \`${src}db/schema/<plural>.ts\` |
| migration | \`${src}db/migrations/\` |
| seed | \`${src}db/seeds/<name>.ts\` |
| validator | \`${src}lib/validators/<singular>.ts\` |
| service | \`${src}services/<plural>.ts\` |
| action | \`${src}app/<segment>/actions.ts\` |
| page, layout, loading, error, not-found | \`${src}app/<segment>/\` |
| handler | \`${src}app/<segment>/route.ts\` |
| component | \`${src}components/<area>/<kebab-name>.tsx\` |
| form | \`${src}components/<area>/<singular>-form.tsx\` |
| hook | \`${src}hooks/use-<name>.ts\` |
| helper | \`${src}lib/<name>.ts\` |
| provider | \`${src}components/providers/<name>-provider.tsx\` |
| type | \`${src}types/<name>.ts\` |
| proxy | \`${src}proxy.ts\` |
| env | \`${src}env.ts\` |
| job | \`${src}jobs/<name>.ts\` |
| email | \`${src}emails/<name>.tsx\` |
| test | beside the source as \`*.test.ts(x)\`, e2e under \`e2e/\` |

## Decisions

| Decision | Value |
|---|---|
| Router | App Router only |
| \`references\` delete behaviour | restrict |
| Server action layout | one \`actions.ts\` per segment |
| Default list page | paginated with \`searchParams\` |
| Service layer | required for all database access |
| Test placement | beside the source |
| Database adapter | ${config.db?.adapter ?? "not set (run `wee db:init`)"} |
| Auth provider | ${config.auth?.provider ?? "not set (run `wee g auth`)"} |
| Jobs provider | ${config.jobs?.provider ?? "not set"} |

## Rules

- Services are the only modules that import the database client. They are marked \`server-only\`.
- Server actions validate input with the validator, check the session, call a service, then revalidate.
- Components are server components unless they need state or browser APIs.
- Every generated file has a test beside it.
`
}

export { conventionsTemplate }
