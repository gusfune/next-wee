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
| `wee db:init --adapter=drizzle [--provider=postgres\|sqlite\|mysql] [--skip-install]` | Drizzle config, client, schema index, seed runner; installs packages. Adopts an existing `drizzle.config.*` and writes only what is missing. Every other `db:*` command and `g model` refuse to run until this has run. |
| `wee g model <Name> <attr:type[:modifier]...> [--skip-migration]` | Model, schema export, validator + test, service, migration. |
| `wee g migration <AddXToY\|RemoveXFromY\|Name> [attrs...]` | Edits the model and writes up + down SQL. Other names give a custom migration. |
| `wee g validator <Name> [attrs...]`, `wee g service <Name> [attrs...]` | Standalone; reuse the `g model` manifest when attrs are omitted. |
| `wee db:generate [--name]`, `db:migrate`, `db:rollback [--step=n]`, `db:status` | Migration lifecycle. Rollback runs `<tag>.down.sql`. |
| `wee db:push`, `db:seed [--file]`, `db:seed:replant [--file]` | Push is local/preview only. Seeds live in `src/db/seeds/`. |
| `wee db:prepare`, `db:reset`, `db:studio`, `db:console` | Create + migrate + seed; reset refuses in production. |
| `wee g page <segment> [--layout] [--skip-loading] [--skip-error]` | `page.tsx`, `loading.tsx`, `error.tsx` (and `layout.tsx`) under `app/<segment>/`. Segments take `[id]`, `[...slug]`, `[[...slug]]` and `(group)`. |
| `wee g layout <segment>`, `wee g handler <segment> [--methods=GET,POST]`, `wee g metadata <segment> [--sitemap] [--og]` | Layout; `route.ts` with typed methods and a Zod body schema; `app/sitemap.ts` and `opengraph-image.tsx` (both when no flag). |
| `wee g component <Name> [--area=<dir>] [--client]`, `g hook <useName>`, `g helper <name> [--shared]`, `g provider <Name>`, `g type <Name> [members...\|attrs...]` | Each writes its file and a Vitest test. `--shared` targets the only non-app workspace (or `--package`); destroy then needs the same `--package`. |
| `wee g action <segment> <name...> [attrs...]` | Blocks in `app/<segment>/actions.ts`. `create`, `update`, `remove` bind to the segment's model; other names are generic (`publish` gives `publishPost`). Manifest name is `<segment>-<names>`. |
| `wee g form <Model>` | Client form in `components/<plural>/<model>-form.tsx` bound to `createX`/`updateX`. Needs `g model` and `g action <plural> create update` first. |
| `wee g env NAME[:server\|client] ...`, `wee g proxy <name> [--matcher=/a/:path*,/b]` | Env adds Zod fields to `env.ts` and keys to `.env.example`; manifest name is the joined kebab names. Proxy adds an interceptor and matcher entries to `proxy.ts`. |

Attribute types: `string text integer decimal boolean datetime uuid json enum[a,b] references`. Modifiers: `unique index optional default=<v>`. See `docs/database-flow.md` for the end-to-end flow.

## Conventions

`CONVENTIONS.md` in the target app is the source of truth for paths and decisions. Read it before you write code by hand. Prefer a generator when one exists.

Generated blocks inside existing files sit between `wee:begin <id>` and `wee:end <id>` comments. Do not edit inside those markers. `destroy` removes them.

## Development of this repo

```
bun install
bun run typecheck
bun run lint
bun run test
bun run build      # dist/cli.js
```

`bun run format` before handing off. Fixtures under `fixtures/` are repo shapes used by the tests; do not add `node_modules` to them.
