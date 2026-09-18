# next-wee

Rails-grade command tooling for Next.js App Router apps. `wee` generates the
files an app needs (models, migrations, pages, forms, actions, jobs, emails,
auth), reverses every run with `destroy`, and wraps the day-to-day commands
(database lifecycle, dev, build, test, ci, credentials) behind one CLI.

Coding agents use it instead of writing boilerplate by hand: one command
gives a typed, tested, conventional result, and `--json` and `--dry-run`
make every command scriptable.

## Install

```
npm install -D next-wee     # or pnpm add -D / yarn add -D / bun add -d
npx wee about
```

Node 22 or newer. Works under npm, pnpm, yarn and bun, in a single repo,
an npm/pnpm/yarn workspace or a Turborepo. `we` is an alias for `wee`.

## How it works

`wee` detects the repo shape and the target app (`--app <name>` or
`--package <name>` in a monorepo), reads `.app/config.json`, and runs a
generator that returns a list of file changes. The changes are applied and
recorded in `.app/manifests/<generator>-<name>.json`, so
`wee destroy <generator> <Name>` reverses the run, including injected
blocks in shared files. Every command accepts `--dry-run`, `--json`,
`--force`, `--app` and `--package`. In `--json` mode the CLI never prompts
and errors go to stderr as `{"error":{"code","message","data"}}`.

## Capabilities

### Project

| Command | Outcome |
|---|---|
| `wee new <name> [--api] [--minimal] [--db=drizzle\|prisma] [--auth=better-auth\|placeholder]` | A Next.js App Router app with wee's files in place: scripts, Biome, Vitest, Playwright, `config/ci.ts`, `AGENTS.md`, `CONVENTIONS.md`, a nav layout and a GitHub Actions workflow. `apps/<name>` inside a monorepo, else `./<name>` with `git init`. |
| `wee about` | Versions and the resolved target. |
| `wee init` | Writes `.app/config.json` and `CONVENTIONS.md` into an existing app. |
| `wee destroy <generator> <Name>` | Reverses a generator run from its manifest, with a drift check. |

### Database

Drizzle and Prisma adapters over Postgres, SQLite and MySQL.

| Command | Outcome |
|---|---|
| `wee db:init --adapter=drizzle\|prisma [--provider=...]` | Config, client, schema, seed runner; installs packages. Drizzle adopts an existing `drizzle.config.*`. |
| `wee g model <Name> <attr:type[:modifier]...>` | Model, schema export, validator with test, service, migration. |
| `wee g migration <AddXToY\|RemoveXFromY\|Name> [attrs...]` | Edits the model and writes up and down SQL. |
| `wee g validator <Name>`, `wee g service <Name>` | Standalone Zod validator and service layer. |
| `wee db:generate`, `db:migrate`, `db:rollback [--step=n]`, `db:status` | Migration lifecycle. Rollback runs the down SQL on Drizzle. |
| `wee db:push`, `db:seed [--file]`, `db:seed:replant` | Push (local and preview only) and seeds from `src/db/seeds/`. |
| `wee db:prepare`, `db:reset`, `db:studio`, `db:console` | Create, migrate and seed; reset refuses in production; Drizzle Studio; SQL shell. |

Attribute types: `string text integer decimal boolean datetime uuid json enum[a,b] references`. Modifiers: `unique index optional default=<v>`.

### Routes and UI

| Command | Outcome |
|---|---|
| `wee g page <segment> [--layout] [--skip-loading] [--skip-error]` | `page.tsx`, `loading.tsx`, `error.tsx` and optional `layout.tsx`. Segments take `[id]`, `[...slug]`, `[[...slug]]` and `(group)`. |
| `wee g layout <segment>`, `g handler <segment> [--methods=GET,POST]`, `g metadata <segment> [--sitemap] [--og]` | Layout; `route.ts` with typed methods, a Zod body schema and a test; sitemap and Open Graph image. |
| `wee g component <Name> [--area] [--client]`, `g hook <useName>`, `g helper <name> [--shared]`, `g provider <Name>`, `g type <Name> [members...]` | Each writes its file and a Vitest test. `--shared` targets a shared package. |
| `wee g action <segment> <name...>` | Server actions in `app/<segment>/actions.ts`; `create`, `update` and `remove` bind to the segment's model. |
| `wee g form <Model>` | Client form bound to the create and update actions. |
| `wee g env NAME[:server\|client] ...`, `wee g proxy <name> [--matcher=...]` | Typed env variables in `env.ts` and `.env.example`; request interceptors in `proxy.ts`. |
| `wee g resource <Name> <attr:type...>` | The whole CRUD flow in one manifest: model, actions, form, list/new/show/edit pages, nav link and a Playwright spec. `--api` writes REST handlers under `app/api/<plural>/` instead of the UI. |
| `wee routes [--grep=<regex>]` | Route table with segment kinds, file type and, after `next build`, the rendering mode. |

### Auth, jobs and mail

| Command | Outcome |
|---|---|
| `wee g auth [--provider=better-auth\|placeholder]` | Better Auth models, migration, server and client setup, API route and sign-in page; or a placeholder with a fixed user outside production. |
| `wee g auth:provider <Name>` | Adds a social provider and its env keys. |
| `wee g job <Name>` | Job function with a test, registered in `jobs/index.ts`. |
| `wee g email <Name>`, `wee mail:preview` | React Email component with a test and Resend setup; the React Email dev server. |

### Run and check

| Command | Outcome |
|---|---|
| `wee dev`, `build`, `start` | `dev` prepares the database and starts Next.js; `build` typechecks first. Turborepo tasks delegate to `turbo run`. |
| `wee lint`, `typecheck`, `test [path] [--watch]`, `test:e2e [--headed]` | Biome or ESLint; `next typegen` then `tsc`; Vitest; Playwright after `db:prepare`. |
| `wee ci` | Runs the steps from `config/ci.ts` and stops at the first failure. |
| `wee console [--sandbox]`, `wee runner <file\|expr>` | Node REPL or one-shot evaluation with `db`, `schema`, `services` and `auth` in scope. `--sandbox` rolls back on exit. |
| `wee stats`, `wee notes` | Code size per primitive with a code-to-test ratio; `TODO`, `FIXME` and `OPTIMISE` annotations. |

### Credentials

| Command | Outcome |
|---|---|
| `wee creds:init`, `creds:edit`, `creds:show`, `creds:fetch <NAME>`, `creds:diff`, `creds:sync --target=vercel` | age-encrypted env files per environment in `config/credentials/`, a git textconv driver for diffs, and sync to a linked Vercel project. |

### Extensibility

| Command | Outcome |
|---|---|
| `wee g generator <Name>` | A custom generator in `tools/generators/<name>/` with a template. `wee g <name> <Name>` runs it with `--dry-run`, `--json` and `destroy`, like a built-in. |
| `wee g task <name>`, `wee <name> [args...]` | A task in `tools/tasks/<name>.ts` that runs with the app context (`db`, `schema`, `services`, `auth`) and its own args. |

Types for extensions come from the package: `import type { GeneratorDef, TaskContext } from "next-wee"`.

## Benchmarks

Reports that measure `wee` against hand-written work on the same task live in [`benchmarks/`](./benchmarks), run with the `wee-benchmark` skill in [`skills/`](./skills).

TODO: write up the benchmark methodology (arm setup, metrics and how to read a report).

## Documentation

[AGENTS.md](./AGENTS.md) has the full command reference for coding agents.
The end-to-end flows are in `docs/`: [database](./docs/database-flow.md),
[routes and UI](./docs/routes-ui-flow.md), [resource](./docs/resource-flow.md),
[auth, jobs and mail](./docs/auth-jobs-mail-flow.md),
[operations](./docs/operations-flow.md) and
[extensibility](./docs/extensibility-flow.md).
[ROADMAP.md](./ROADMAP.md) lists postponed work and known issues.

## Development

```
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

## License

MIT
