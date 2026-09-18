# AGENTS.md

Guide for coding agents and people working on `next-wee` or using it inside a Next.js app. The first half explains the project; the second half is the command reference for an app that has `wee` installed.

## What this is

`next-wee` is a CLI (`wee`, alias `we`) for Next.js App Router apps. It generates the files an app needs, reverses every run, and wraps the daily commands behind one tool: models and migrations, pages, forms, server actions, jobs, emails, auth, database lifecycle, dev, build, test, ci and encrypted credentials. It runs on Node 22+ under npm, pnpm, yarn and bun, in a single repo, a workspace or a Turborepo.

## The idea

Rails made a generation of developers fast because `rails generate` and `rails db:migrate` gave every app the same shape. Next.js has no equivalent: each app writes its own scaffolding, and a coding agent writes it again for each task, token by token. `wee` moves that work into deterministic generators, so one command yields a typed, tested, conventional result and an agent spends its tokens on the part that is specific to the app.

Three rules follow from that:

- Every run is reversible. A generator returns a list of file changes; the CLI applies them and records a manifest under `.app/manifests/`, and `wee destroy <generator> <Name>` takes the run back, including blocks injected into shared files.
- Every command is scriptable. `--dry-run` prints the plan, `--json` prints machine-readable rows and never prompts, and errors carry a stable code.
- Conventions live in the app. `wee init` writes `CONVENTIONS.md` and `.app/config.json`; generators read them, and an app extends the CLI with its own generators and tasks under `tools/` without forking it.

## How a command runs

1. `src/cli.ts` builds the citty command map from `src/commands/builtins.ts`. When the first token is not a built-in, `src/lib/custom.ts` scans the target's `tools/tasks/` and adds those as commands.
2. `defineWeeCommand` in `src/core/command.ts` parses the global flags and builds a `Context` (`src/core/context.ts`): repo shape (`src/core/repo.ts`), target workspace (`src/core/workspace.ts`), merged config (`src/core/config.ts`) and app layout.
3. A generator (`defineGenerator` in `src/core/generator.ts`) turns its args into `FileChange[]` (`src/core/changes.ts`: create, modify, ensure, inject, delete). It reads templates from `src/templates/` and never touches the disk itself.
4. `runGenerator` applies the changes (or describes them under `--dry-run`), writes the manifest (`src/core/manifest.ts`) and returns rows that `src/core/output.ts` prints as a table or JSON. Injections use `wee:begin <id>` / `wee:end <id>` markers (`src/core/inject.ts`).
5. Database work goes through a `DbAdapter` (`src/core/adapters.ts`; Drizzle and Prisma under `src/adapters/`). Commands that must run inside the app (console, runner, tasks, ci config, custom generators) spawn a child through `runScript` in `src/lib/packages.ts` with the scripts under `src/runtime/`, bundled to `dist/runtime/`.
6. Custom generators in `tools/generators/<name>/index.ts` run in that child and send their `FileChange[]` back; the CLI validates and applies them like a built-in, so they inherit the global flags and `destroy`. `src/index.ts` exports the public types (`GeneratorDef`, `TaskContext`, `FileChange`, `Context`).

Each flow has one document under `docs/`: `database-flow.md`, `routes-ui-flow.md`, `resource-flow.md`, `auth-jobs-mail-flow.md`, `operations-flow.md`, `extensibility-flow.md`.

## Repo layout

| Path | Contents |
|---|---|
| `src/cli.ts`, `src/index.ts` | Entry point; public types |
| `src/core/` | Context, config, changes, inject, manifest, generator contract, output, errors |
| `src/commands/` | One file per command; `g/` holds the generators |
| `src/adapters/` | Drizzle and Prisma `DbAdapter` implementations |
| `src/templates/` | File templates as functions returning strings |
| `src/lib/` | Attribute grammar, inflection, segments, package manager and script runners, extension discovery |
| `src/runtime/` | Scripts that run inside the target app |
| `test/` | Vitest suites; each phase has an acceptance test that scaffolds a scratch app from `fixtures/` |
| `fixtures/` | Repo shapes (single repo, pnpm workspace, Turborepo, Pages Router); never add `node_modules` to them |
| `docs/` | One flow document per phase |
| `ROADMAP.md` | Postponed work and known issues, with the reason for each |

## Working on this repo

```
bun install
bun run typecheck
bun run lint
bun run test
bun run build      # dist/cli.js, dist/index.d.ts, dist/runtime/*
bun run format     # last, before handing off
```

`WEE_E2E=1 bun run test` also runs the Playwright step of `wee ci` in the operations test; it needs a Chromium build (`bunx playwright install chromium`).

Rules:

- TypeScript, strict, no `any`. Named exports at the end of the file, arrow functions, `import type` for types. Biome owns formatting: no semicolons, double quotes, 2 spaces.
- A generator is pure: it returns changes and does not write. New file kinds go through `FileChange`; new shared-file edits go through `inject` with a marker, so `destroy` stays complete.
- Every command supports `--dry-run` and `--json`. Every generator run has a manifest. Every changed behaviour has a test in `test/` that scaffolds from a fixture.
- One flow document per feature area in `docs/`; do not spread explanations across inline comments. Comments explain why, not what.
- Deferred items and known issues go to `ROADMAP.md` with the reason and a target.
- Commits: Conventional Commits with a Gitmoji after the colon (`feat(g): ✨ add g task`), one logical change each. Pull requests target `staging`.

## Using wee in an app

Coding agents use `wee` instead of writing boilerplate by hand. `wee new <name>` writes an `AGENTS.md` and `CONVENTIONS.md` into the app with this reference.

## Invocation

Run it through the project's package manager: `npx wee`, `pnpm wee`, `yarn wee` or `bun wee`. `we` is an alias.

Every command accepts:

| Flag | Effect |
|---|---|
| `--dry-run` | Print the plan. Write nothing. |
| `--json` | Machine-readable output on stdout. Errors go to stderr as `{"error":{"code","message","data"}}`. |
| `--force` | Skip safety checks (overwrite config, destroy with drift). |
| `--app <name>` | Target a workspace by package name in a monorepo. |
| `--package <name>` | Target a shared package by name in a monorepo. |

Exit code is non-zero on the first error. In `--json` mode the CLI never prompts. When several Next.js apps exist and `--app` is missing, it fails with the candidate list.

## Commands

| Command | Outcome |
|---|---|
| `wee about` | Versions and the resolved target. Run this first to confirm the target. |
| `wee init` | Writes `.app/config.json` and `CONVENTIONS.md` into the target app. |
| `wee destroy <generator> <Name>` | Reverses a generator run from `.app/manifests/<generator>-<name>.json`. |
| `wee db:init --adapter=drizzle\|prisma [--provider=postgres\|sqlite\|mysql] [--skip-install]` | Config, client, schema, seed runner; installs packages. Drizzle adopts an existing `drizzle.config.*` and writes only what is missing. Prisma writes a schema folder and `prisma.config.ts`. Every other `db:*` command and `g model` refuse to run until this has run. |
| `wee g model <Name> <attr:type[:modifier]...> [--skip-migration]` | Model, schema export, validator + test, service, migration. |
| `wee g migration <AddXToY\|RemoveXFromY\|Name> [attrs...]` | Edits the model and writes up + down SQL. Other names give a custom migration. |
| `wee g validator <Name> [attrs...]`, `wee g service <Name> [attrs...]` | Standalone; reuse the `g model` manifest when attrs are omitted. |
| `wee db:generate [--name]`, `db:migrate`, `db:rollback [--step=n]`, `db:status` | Migration lifecycle. Rollback runs `<tag>.down.sql` on Drizzle; on Prisma it fails with `rollback-manual` and prints the steps. |
| `wee db:push`, `db:seed [--file]`, `db:seed:replant [--file]` | Push is local/preview only. Seeds live in `src/db/seeds/`. |
| `wee db:prepare`, `db:reset`, `db:studio`, `db:console` | Create + migrate + seed; reset refuses in production. |
| `wee g page <segment> [--layout] [--skip-loading] [--skip-error]` | `page.tsx`, `loading.tsx`, `error.tsx` (and `layout.tsx`) under `app/<segment>/`. Segments take `[id]`, `[...slug]`, `[[...slug]]` and `(group)`; quote them in zsh (`"posts/[id]"`). |
| `wee g layout <segment>`, `wee g handler <segment> [--methods=GET,POST]`, `wee g metadata <segment> [--sitemap] [--og]` | Layout; `route.ts` with typed methods and a Zod body schema; `app/sitemap.ts` and `opengraph-image.tsx` (both when no flag). |
| `wee g component <Name> [--area=<dir>] [--client]`, `g hook <useName>`, `g helper <name> [--shared]`, `g provider <Name>`, `g type <Name> [members...\|attrs...]` | Each writes its file and a Vitest test. `--shared` targets the only non-app workspace (or `--package`); destroy then needs the same `--package`. |
| `wee g action <segment> <name...> [attrs...]` | Blocks in `app/<segment>/actions.ts`. `create`, `update`, `remove` bind to the segment's model; other names are generic (`publish` gives `publishPost`). Manifest name is `<segment>-<names>`. |
| `wee g form <Model>` | Client form in `components/<plural>/<model>-form.tsx` bound to `createX`/`updateX`. Needs `g model` and `g action <plural> create update` first. |
| `wee g resource <Name> <attr:type...> [--skip-migration] [--skip-loading] [--skip-error] [--skip-install]` | The whole CRUD flow in one manifest: model, `app/<plural>/actions.ts` with create/update/remove, form, list/new/show/edit pages with boundaries, `lib/display.ts`, a link in `components/nav.tsx` and `e2e/<plural>.spec.ts`. Installs `@playwright/test`. Render `<Nav />` from the root layout by hand. `destroy resource <Name>` takes it all back. |
| `wee g auth [--provider=better-auth\|placeholder] [--skip-install]` | Better Auth: four models in one `create_auth_tables` migration, `lib/auth/index.ts`, `lib/auth/providers.ts`, `lib/auth/client.ts`, `app/api/auth/[...all]/route.ts`, `app/sign-in/page.tsx` and the sign-in form + test. Placeholder: `lib/auth/index.ts` only, with a fixed user outside production. Manifest name is the provider. Run `db:migrate` afterwards. |
| `wee g auth:provider <Name>` | Adds `<id>` to `socialProviders` in `lib/auth/providers.ts` and `<ID>_CLIENT_ID` / `<ID>_CLIENT_SECRET` to `.env.example`. Needs `g auth --provider=better-auth` first. |
| `wee g job <Name> [--skip-install]` | Job function in `jobs/<name>.ts` with a test, registered in `jobs/index.ts`. A plain async function with a Zod input, so any queue or scheduler can run it. |
| `wee g email <Name> [--skip-install]` | React Email component in `emails/<name>.tsx` with a test. The first run also writes `lib/mail.ts` (Resend). |
| `wee mail:preview [--port=3001]` | Runs the React Email dev server on `src/emails`. |
| `wee routes [--grep=<regex>]` | Table of route path, segment kinds (`static`, `dynamic`, `catch-all`, `optional-catch-all`, `group`, `parallel`, `intercepting`), file type (`page`, `layout`, `handler`, `metadata`) and, after `next build`, the rendering mode (`static`, `isr`, `dynamic`). |
| `wee console [--sandbox]`, `wee runner <file\|expr> [--sandbox]` | Node REPL, or one expression or file, with `db`, `schema` (Drizzle only), `services` and `auth` in scope. Runs inside the app through `bun` or `node --import tsx`. The runner exits 1 when the result is `false` or it throws. `--sandbox` rolls back on exit. |
| `wee g env NAME[:server\|client] ...`, `wee g proxy <name> [--matcher=/a/:path*,/b]` | Env adds Zod fields to `env.ts` and keys to `.env.example`; manifest name is the joined kebab names. Proxy adds an interceptor and matcher entries to `proxy.ts`. |
| `wee new <name> [--api] [--minimal] [--db=drizzle\|prisma] [--auth=better-auth\|placeholder] [--skip-install]` | A Next.js App Router app with wee's files in place: scripts that call `wee`, Biome, Vitest, Playwright, `config/ci.ts`, `AGENTS.md`, `CONVENTIONS.md`, a nav layout and a GitHub Actions workflow. `apps/<name>` inside a monorepo, else `./<name>` with `git init`. `--db` and `--auth` run `db:init` and `g auth` afterwards. No `--app` or `--package`. |
| `wee dev [--port]`, `wee build`, `wee start [--port]` | `dev` runs `db:prepare`, then `next dev`. `build` typechecks first. Turborepo tasks delegate to `turbo run <task> --filter=<app>`. |
| `wee lint`, `wee typecheck`, `wee test [path] [--watch]`, `wee test:e2e [--headed]` | Biome (`biome lint`) or ESLint; `next typegen` then `tsc --noEmit`; Vitest; Playwright after `db:prepare` (writes `playwright.config.ts` when missing). Exit code is the tool's; `--json` reports `<step>-failed` with the output. |
| `wee ci` | Runs the `steps` from `config/ci.ts` (built-in names or `{ name, command }`) and stops at the first failure with `ci-failed`. Without the file: lint, typecheck, test, test:e2e (when `e2e/` exists), build. One line per step; `--json` gives `[{ step, status, duration }]`. |
| `wee stats`, `wee notes` | Files, lines and code per primitive with a code-to-test ratio; `TODO`, `FIXME` and `OPTIMISE` annotations with file and line. |
| `wee g generator <Name>` | Custom generator in `tools/generators/<name>/index.ts` with a `templates/<name>.ts.tpl`. Discovered by directory name: `wee g <name> <Name>` runs it with `--dry-run`, `--json` and `destroy` like a built-in. Depends on `next-wee` for types only. |
| `wee g task <name>`, `wee <name> [args...]` | Task in `tools/tasks/<kebab-name>.ts` exporting `task(ctx: TaskContext)`. Runs as `wee <name>` (colon or dash spelling) with `db`, `schema`, `services`, `auth` and `args` in scope; no database needed. Returns `false` or throws to exit 1. |
| `wee creds:init`, `creds:edit [--env]`, `creds:show [--env]`, `creds:fetch <NAME> [--env]`, `creds:diff <path>\|--enroll`, `creds:sync --target=vercel [--env]` | age-encrypted env files in `config/credentials/<env>.env.enc`; `--env` defaults to `APP_ENV`, then `local`. The recipient file is committed; the identity stays in `config/credentials/.age-identity` or `WEE_CREDENTIALS_KEY`. `diff --enroll` registers the git textconv driver. `sync` pushes every key to the linked Vercel project. |

Attribute types: `string text integer decimal boolean datetime uuid json enum[a,b] references`. Modifiers: `unique index optional default=<v>`. See `docs/database-flow.md`, `docs/routes-ui-flow.md`, `docs/resource-flow.md`, `docs/auth-jobs-mail-flow.md`, `docs/operations-flow.md` and `docs/extensibility-flow.md` for the end-to-end flows.

## Conventions

`CONVENTIONS.md` in the target app is the source of truth for paths and decisions. Read it before you write code by hand. Prefer a generator when one exists. Run `wee ci` before you hand off.

Generated blocks inside existing files sit between `wee:begin <id>` and `wee:end <id>` comments. Do not edit inside those markers. `destroy` removes them.
