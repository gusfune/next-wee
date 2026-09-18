# Operations flow

How `wee new` scaffolds an app, how the run and check commands reach the
app's own tools, how `wee ci` reads `config/ci.ts`, and how credentials are
stored and synced. Phase 5 of PLAN.md.

## `new <name>`

`new` is the one command that runs without a Context: the target does not
exist yet. It has no `--app` or `--package` flag.

Placement: `findMonorepoRoot(cwd)` walks up for a `turbo.json`, a
`pnpm-workspace.yaml` or a `package.json` with `workspaces`, stopping at
the first `.git`. Inside a monorepo the app goes to `apps/<name>` and the
root workspace list gets `apps/*` when no pattern covers it (`package.json`
`workspaces` or `pnpm-workspace.yaml` `packages`). Outside a monorepo the
app goes to `./<name>` and gets `git init` when `cwd` is not in a git
repo. A non-empty target directory fails with `dir-exists`.

Package manager: the monorepo's, else `bun` when `bun --version` answers,
else `npm`. Versions in the new `package.json` come from wee's own
`package.json`, so a new app starts on the toolchain wee is tested
against. `next-wee` is pinned to the running CLI version.

Files (`templates/new.ts`): `package.json` with `dev build start lint
typecheck test test:e2e ci` scripts that call `wee`, `tsconfig.json`,
`next.config.ts`, `biome.json`, `vitest.config.ts` (unit tests under
`src/`; Playwright owns `e2e/`), `src/app/layout.tsx` rendering `<Nav />`,
`src/app/page.tsx` + test, `src/components/nav.tsx`, `src/env.ts`,
`.env.example`, `.gitignore`, `README.md`, `AGENTS.md`, `CONVENTIONS.md`,
`.app/config.json`, `config/ci.ts`, `playwright.config.ts`,
`e2e/smoke.spec.ts`, and `.github/workflows/ci.yml` for a standalone app.
`--api` swaps the page and nav for `src/app/api/health/route.ts` + test.
`--minimal` drops Playwright, `e2e/`, the `test:e2e` script and the
`test:e2e` CI step. `--minimal --auth` fails with `flag-conflict`.

After the files: `installDependencies` through nypm unless
`--skip-install`, then `--db=<adapter>` runs the `db:init` body
(`runDbInit`) and `--auth=<provider>` runs the `g auth` body (`runAuth`)
with a Context built in the new app. The Context is rebuilt between the
two because `g auth` reads the `db` section `db:init` just wrote.

`next-wee` is not on npm yet, so a real install fails until it is
published. The tests pass `--skip-install`.

## Run and check commands

`lib/tasks.ts` holds the runners; `commands/quality.ts` and
`commands/ops.ts` wrap them. Every runner resolves a binary from the app's
`node_modules` (walking up for hoisted monorepos) and runs it with the
app as `cwd`. Output streams to the terminal; the command exits with the
tool's exit code. In `--json` mode output is captured and one row is
printed, or the failure is reported as `{"error":{"code":"<step>-failed",
"data":{"output"}}}`.

| Command | What runs |
|---|---|
| `lint` | Biome (`biome lint .`) when the app or repo root has `biome.json(c)`, else ESLint (`eslint .`) when an ESLint config exists. Neither: `linter-missing`. `biome lint`, not `biome check`: generated code is not run through the formatter. |
| `typecheck` | `next typegen` (apps only), then `tsc --noEmit -p .`. |
| `test [path] [--watch]` | `vitest run [path]` or `vitest watch [path]`. |
| `test:e2e [--headed]` | Writes `playwright.config.ts` when missing, runs `db:prepare` when a `db` section exists, then `playwright test`. |
| `dev [--port]` | `db:prepare` when a `db` section exists, the Inngest dev server when `jobs.provider` is `inngest` and `inngest-cli` is installed, then `next dev`. The jobs server is killed when `next dev` exits. |
| `build` | `typecheck`, then `next build`. |
| `start [--port]` | `next start`. No typecheck: `start` serves a finished build. |

Turborepo: when `turbo.json` defines the task and the target is not the
repo root, `dev`, `build`, `test` and `lint` run
`turbo run <task> --filter=<app>` from the root. `test` delegates only
without a path and without `--watch`.

## `ci`

`ci` reads `config/ci.ts` from the app. The file exports `steps`, a list
of built-in step names (`lint`, `typecheck`, `test`, `test:e2e`, `build`)
or `{ name, command }` objects. Because the file is TypeScript inside the
app, wee runs `runtime/ci-config.ts` through `runScript` (bun, or
`node --import tsx`) with the app as `cwd`; the runtime imports the file
and prints `steps` as JSON, which `ci` validates with Zod
(`ci-config-invalid` on failure). Without the file the five built-in
steps run, minus `test:e2e` when the app has no `e2e/` folder.

Steps run in order. A custom step runs `sh -c <command>` in the app. Human
mode prints one line per step (`✓ lint 0.1s`, `✗ test 3.0s`) after the
step's own output; `--json` returns `[{ step, status, duration }]`. The
first failure stops the run and exits with that step's exit code
(`ci-failed`, with the rows so far in `data.steps`).

The GitHub Actions workflow `new` writes installs dependencies with the
detected package manager, installs Chromium for Playwright when the app
has e2e tests, and runs `wee ci`. The same runner serves locally and in
CI.

## `stats` and `notes`

`stats` counts files, lines and non-blank non-comment lines per primitive
and prints a code-to-test ratio. `lib/primitives.ts` classifies a path by
its location and file name into one of: model, migration, seed, validator,
service, action, page, layout, boundary, handler, metadata, component,
form, hook, helper, provider, type, proxy, env, job, email, auth, test,
e2e. `notes` lists `TODO`, `FIXME` and `OPTIMISE` (or `OPTIMIZE`)
annotations with file, line and text. Both read the app's source folder
and skip `node_modules` and `.next`.

## Credentials

`creds:*` stores one encrypted env file per environment under
`config/credentials/` with [age](https://age-encryption.org) through the
`age-encryption` package; no system `age` binary is needed.

`creds:init` generates a key pair: the public recipient goes to
`config/credentials/.age-recipients` (committed), the identity to
`config/credentials/.age-identity` (mode 0600, added to `.gitignore`).
`WEE_CREDENTIALS_KEY` holds the identity in CI and on servers. Every
other `creds:*` command takes `--env=<name>`; the default is `APP_ENV`,
then `local`.

`creds:edit` decrypts `<env>.env.enc` (or starts empty), opens `$EDITOR`,
re-encrypts on save. `creds:show` prints the plaintext. `creds:fetch NAME`
prints one value for shell substitution. `creds:diff <path>` is a git
`textconv` for the `.enc` files; it resolves the identity from
`<dirname>/.age-identity`, and `creds:diff --enroll` registers the driver
in `.gitattributes` and `git config diff.wee_credentials`.
`creds:sync --target=vercel` pushes every key with
`vercel env add <name> <environment> --force --yes` through the `vercel`
CLI installed in the app or on `PATH`; `local` maps to `development`,
`preview` to `preview`, `production` to `production`. The Vercel link is
checked first (`vercel-not-linked`).

## Acceptance

`test/operations.test.ts` runs `new blog --db=drizzle --auth=placeholder
--skip-install`, the `--api --minimal` variant, the monorepo placement,
then builds the resource app (`new`, `db:init` on SQLite, `g resource
Post`) and runs `typecheck` and `ci`. `ci` covers lint, typecheck, test and
build; the `test:e2e` step runs when `WEE_E2E=1`, which the repo's own
GitHub Actions sets after `playwright install chromium`. The scratch app
lives under `.scratch/` in the repo because Turbopack refuses a
`node_modules` symlink that points outside the workspace root.
