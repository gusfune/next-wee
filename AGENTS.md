# Agent guide

`wee` is a CLI for Next.js App Router apps. Coding agents use it instead of writing boilerplate by hand.

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
| `wee g job <Name> [--skip-install]` | Inngest function in `jobs/<name>.ts` (event `<app>/<name>`) with a test, registered in `jobs/index.ts`. The first run also writes `lib/inngest.ts` and `app/api/inngest/route.ts`. |
| `wee g email <Name> [--skip-install]` | React Email component in `emails/<name>.tsx` with a test. The first run also writes `lib/mail.ts` (Resend). |
| `wee mail:preview [--port=3001]` | Runs the React Email dev server on `src/emails`. |
| `wee routes [--grep=<regex>]` | Table of route path, segment kinds (`static`, `dynamic`, `catch-all`, `optional-catch-all`, `group`, `parallel`, `intercepting`), file type (`page`, `layout`, `handler`, `metadata`) and, after `next build`, the rendering mode (`static`, `isr`, `dynamic`). |
| `wee console [--sandbox]`, `wee runner <file\|expr> [--sandbox]` | Node REPL, or one expression or file, with `db`, `schema` (Drizzle only), `services` and `auth` in scope. Runs inside the app through `bun` or `node --import tsx`. The runner exits 1 when the result is `false` or it throws. `--sandbox` rolls back on exit. |
| `wee g env NAME[:server\|client] ...`, `wee g proxy <name> [--matcher=/a/:path*,/b]` | Env adds Zod fields to `env.ts` and keys to `.env.example`; manifest name is the joined kebab names. Proxy adds an interceptor and matcher entries to `proxy.ts`. |
| `wee new <name> [--api] [--minimal] [--db=drizzle\|prisma] [--auth=better-auth\|placeholder] [--skip-install]` | A Next.js App Router app with wee's files in place: scripts that call `wee`, Biome, Vitest, Playwright, `config/ci.ts`, `AGENTS.md`, `CONVENTIONS.md`, a nav layout and a GitHub Actions workflow. `apps/<name>` inside a monorepo, else `./<name>` with `git init`. `--db` and `--auth` run `db:init` and `g auth` afterwards. No `--app` or `--package`. |
| `wee dev [--port]`, `wee build`, `wee start [--port]` | `dev` runs `db:prepare`, the Inngest dev server when configured, then `next dev`. `build` typechecks first. Turborepo tasks delegate to `turbo run <task> --filter=<app>`. |
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

## Development of this repo

```
bun install
bun run typecheck
bun run lint
bun run test
bun run build      # dist/cli.js
```

`bun run format` before handing off. Fixtures under `fixtures/` are repo shapes used by the tests; do not add `node_modules` to them. `WEE_E2E=1 bun run test` also runs the Playwright step of `wee ci` in the acceptance test; it needs a Chromium build (`bunx playwright install chromium`).
