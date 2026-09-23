# next-wee

Generators, migrations and one task runner for Next.js App Router apps.
`wee` writes the files an app needs (models, migrations, pages, forms,
server actions, jobs, emails, auth), records each run so `wee destroy` can
take it back, and runs the daily commands (database, dev, build, test, ci,
credentials) through one CLI.

Coding agents use it in place of hand-written boilerplate. One command
gives a typed and tested result. `--json` and `--dry-run` make every
command scriptable.

## Start a new app

```sh
npx -p next-wee wee new my-app --db=drizzle
cd my-app
npx wee db:init --provider=sqlite --force   # optional: SQLite in place of Postgres
npx wee g resource Post title:string body:text published_at:datetime:optional
npx wee db:migrate
npx wee dev
npx wee ci                                  # lint, typecheck, test, e2e, build
```

`g resource` writes the model, migration, validator, service, server
actions, form, list/new/show/edit pages, a nav link and a Playwright spec.
Render `<Nav />` from the root layout by hand.

## Add wee to an existing app

```sh
npm install -D next-wee     # or: pnpm add -D, yarn add -D, bun add -d
npx wee about               # versions and the resolved target app
npx wee init                # .app/config.json and CONVENTIONS.md
```

Requirements: Node 22 or newer, and a Next.js App Router app. wee works
under npm, pnpm, yarn and bun, in a single repo, a workspace or a
Turborepo. `we` is an alias for `wee`.

## How it works

A generator returns a list of file changes. wee applies them and records
them in `.app/manifests/<generator>-<name>.json`. `wee destroy <generator>
<Name>` reverses the run, including the blocks it injected into shared
files between `wee:begin` and `wee:end` markers. A `--force` re-run folds
into the same manifest, so `destroy` still returns the app to its state
before the first run.

Every command accepts `--json`, `--force`, `--app <name>` and
`--package <name>` (to pick a target in a monorepo). Generators, `destroy`,
`init`, `db:init`, `db:status`, the `creds:*` commands and the read-only
reports support `--dry-run`. Other commands skip under `--dry-run` and run
nothing. In `--json` mode wee never prompts and prints errors to stderr as
`{"error":{"code","message","data"}}`.

## Commands

[AGENTS.md](./AGENTS.md) is the full reference, with every flag.

| Area                                                    | Commands                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project                                                 | `new`, `about`, `init`, `destroy`                                                                                                                                                                                      |
| Database (Drizzle or Prisma; Postgres, SQLite or MySQL) | `db:init`, `g model`, `g migration`, `g validator`, `g service`, `db:generate`, `db:migrate`, `db:rollback`, `db:status`, `db:push`, `db:seed`, `db:seed:replant`, `db:prepare`, `db:reset`, `db:studio`, `db:console` |
| Routes and UI                                           | `g page`, `g layout`, `g handler`, `g metadata`, `g component`, `g hook`, `g helper`, `g provider`, `g type`, `g action`, `g form`, `g resource`, `g env`, `g proxy`, `routes`                                         |
| Auth, jobs and mail                                     | `g auth` (Better Auth or a placeholder), `g auth:provider`, `g job`, `g email`, `mail:preview`                                                                                                                         |
| Run and check                                           | `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `ci`, `console`, `runner`, `stats`, `notes`                                                                                                          |
| Credentials                                             | `creds:init`, `creds:edit`, `creds:show`, `creds:fetch`, `creds:diff`, `creds:sync` (age-encrypted env files per environment)                                                                                          |
| Extensions                                              | `g generator` (custom generators in `tools/generators/`), `g task` (tasks in `tools/tasks/`, run as `wee <name>`)                                                                                                      |

Attribute syntax for `g model`, `g migration` and `g resource`:
`name:type[:modifier...]`. Types: `string text integer decimal boolean
datetime uuid json enum[a,b] references`. Modifiers: `unique index optional
default=<value>`. wee checks each default against its type.

Extensions import their types from the package:
`import type { GeneratorDef, TaskContext } from "next-wee"`.

## Documentation

One document per flow, in `docs/`:
[database](./docs/database-flow.md),
[routes and UI](./docs/routes-ui-flow.md),
[resource](./docs/resource-flow.md),
[auth, jobs and mail](./docs/auth-jobs-mail-flow.md),
[operations](./docs/operations-flow.md) and
[extensibility](./docs/extensibility-flow.md).
[ROADMAP.md](./ROADMAP.md) lists postponed work and known issues.

## Benchmarks

[`benchmarks/`](./benchmarks) holds reports that run one task twice from
the same prompt: once with wee and once by hand, each in a fresh subagent
and a fresh copy of the same app. The report compares tokens, tool calls,
wall time and the checks each arm passed. The
[`wee-benchmark`](./skills/wee-benchmark/SKILL.md) skill runs the
procedure. In the 2026-09-18 run (one sample per arm), wee used 41% fewer
billed tokens for `model Post` and 45% fewer for `resource Post`, and 56%
more for `job SendWelcome`.

## Development

```sh
bun install
bun run typecheck
bun run lint
bun run test         # WEE_E2E=1 also runs the Playwright step of wee ci
bun run build        # dist/cli.js, dist/index.d.ts, dist/runtime/*
bun run format       # last, before a commit
```

`WEE_E2E=1` needs Chromium: `bunx playwright install chromium`.

## License

MIT
