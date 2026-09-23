# Roadmap

Work we postponed on purpose, and issues we found and did not fix in the phase that found them. README.md says what ships; this file says what each phase left behind and why. Add an entry when you defer something. Remove it when it ships.

## Postponed

| Item | Deferred in | Why | Target |
|---|---|---|---|
| Postgres and MySQL driver tests in CI | Phase 1 | CI has no database service. `driver.ts` for both providers is written but only the SQLite path runs in `test/db.test.ts`. Phase 5 added `wee ci` for apps, not services to this repo's workflow. | When the workflow gets a Postgres and a MySQL service |
| `installPackages` and `new` install test | Phase 1 | Needs network or a registry mock. `test/db-init-install.test.ts` mocks the install for `db:init`; `new` without `--skip-install` has no test. `new --skip-install` covers the file side. | When the suite gets a local registry |
| `db:console` and `db:studio` tests | Phase 1 | Both spawn interactive processes. Manual check only. | When a PTY harness exists |
| Seed runner, `console`, `runner`, `ci` and Turborepo delegation in a real monorepo | Phase 1 | `tsx` is installed per app; `runScript` and the task runners are verified in single-app scratch apps only. `delegatesToTurbo` is unit-level: no fixture has `turbo` installed. | When a monorepo fixture with its own install exists |
| `g migration` for renames and type changes | Phase 1 | Only `AddXToY`, `RemoveXFromY` and custom. Rename needs a different model edit and drizzle-kit prompts on ambiguity. | On request |
| Composite indexes and `references` with `onDelete` other than restrict | Phase 1 | Attribute grammar has one column per index. Decision table fixes restrict. | On request |
| Adoption of a Drizzle config that uses a `schema` array, a single schema file or a computed value | Phase 1 | `adopt.ts` reads string literals only and needs a schema directory for the barrel. Fails with `drizzle-config-unsupported` and names the fix. | On request |
| Adoption of a client that does not live at `src/db/client.ts` | Phase 1 | Generated services and the `console` preload import `src/db/client.ts`. Adoption creates that file when missing; an app with a client elsewhere gets two clients until the user points one at the other. Needs a `clientPath` config field. | On request |
| Intercepting (`(.)`) and parallel (`@slot`) route segments | Phase 2 | `parseSegment` accepts static parts, `(group)` and `[param]` forms only. Fails with `invalid-segment`. | On request |
| `g form` and `g resource` segment choice | Phase 2 | The form always binds to `app/<plural>/actions.ts` and lives in `components/<plural>/`; `g resource` mounts at `/<plural>`. A `--segment` flag would cover nested resources such as `posts/[id]/comments`. | On request |
| Redirect after create | Phase 3 | `createX` returns a success state and the form stays on `/posts/new`. Rails redirects to the show page. Needs `redirect()` in the action and a form that tolerates it. | On request |
| `console --sandbox` on Postgres and MySQL | Phase 3 | The session runs inside `db.transaction` with the transaction handle as `db`, but generated services import the pooled client, so `services.posts.createPost()` commits. SQLite runs BEGIN/ROLLBACK on the single connection and covers services too. | On request. Phase 4 kept the limit; on Prisma `--sandbox` covers `db` only on every provider. |
| Defaults and overrides for generator output | Phase 3 | Every generator hard-codes its choices: page params, list pagination (20 per page), the form's input types, the nav label, the e2e sample values, the boundary files. An app should be able to set defaults once (in `.app/config.json` or `CONVENTIONS.md`) and override them per run with flags, e.g. `g page posts --params=id:uuid`, `g resource Post --per-page=50`, or a config block that turns `loading.tsx` off everywhere. Needs a `defaults` section in the config schema and one resolution order: flag, then app config, then built-in. Phase 6 shipped custom generators without it. | On request |
| `routes` rendering mode for route handlers with `generateStaticParams` | Phase 3 | Dynamic routes in `prerender-manifest.json` are reported as `static`; the fallback mode is not shown. | On request |
| `robots.ts` | Phase 2 | `g metadata --sitemap` writes one shared `app/sitemap.ts` with one entry per segment; there is no `robots.ts` generator. | On request |
| `g env` options: optional variables, non-string types | Phase 2 | Every variable is `z.string()` required. | On request |
| Removing one variable or one action from a multi-item run | Phase 2 | One manifest per run; `destroy` reverses the whole run. Split runs to keep them separate. | On request |
| shadcn/ui as an integrated part of the generators | Phase 2 | `g component`, `g form`, `g page` and `g provider` emit plain HTML elements. When the app has `components.json`, they should import shadcn primitives (`Button`, `Input`, `Field`, `Card`) from `components/ui/`, run `shadcn add` for the ones that are missing, and `g provider Theme` should wrap `next-themes`. Needs a UI adapter next to `DbAdapter` so the plain-HTML output stays the default. Phase 6 shipped custom generators without it. | On request |
| Adoption of an existing Prisma setup | Phase 4 | `db:init --adapter=prisma` writes its own `prisma.config.ts` and schema folder and fails with `file-exists` when they exist. Drizzle adoption reads string literals from the config; Prisma would need the same for `schema` and `migrations.path`. | On request |
| `db:generate` on Prisma with Postgres or MySQL | Phase 4 | `prisma migrate diff --from-migrations` needs a shadow database for these providers. SQLite runs without one. | When the workflow gets database services |
| Two `references` to the same model on Prisma | Phase 4 | Prisma needs named relations when a model points at another model twice. The generator writes unnamed relations and `prisma validate` reports the clash. | On request |
| `json` attributes on Prisma | Phase 4 | The validator emits `z.unknown()`, and Prisma create input wants `InputJsonValue`, so the generated service may not typecheck for a model with a `json` attribute. The suite has no Prisma model with `json`. | On request |
| `schema` scope in `console` on Prisma | Phase 4 | Prisma has no schema module; the scope is `undefined`. `db` and `services` work. | On request |
| Validation of the auth provider id | Phase 4 | `g auth:provider Foo` writes `foo` and `typecheck` reports it through `satisfies`. A list of Better Auth ids would catch it at generation time and go stale with upgrades. | On request |
| `mail:preview` test | Phase 4 | Spawns the React Email dev server. Only the `emails-missing` path runs in the suite. | When a PTY harness exists |
| Sign-up page and sign-out | Phase 4 | The sign-in form toggles to sign-up inline and there is no sign-out control. A `g auth` option for separate pages and a `<SignOut />` component would complete the flow. | On request |
| `creds:sync` against a live Vercel project | Phase 5 | Needs a linked project and a token. The suite covers the argument mapping and the `vercel-not-linked` failure only. | When a Vercel test project exists |
| `start` without a typecheck | Phase 5 | The spec lists `typecheck` for `start`; wee runs `next start` only, because `build` already typechecked and `start` serves the finished build. | Decision; revisit on request |
| Biome-formatted generator output | Phase 5 | `wee lint` runs `biome lint`, not `biome check`, because generated files (and drizzle-kit's JSON) do not match the Biome formatter. Formatting templates through Biome after generation would let `lint` run `check`. | On request |
| `--provider` for `new --db` | Phase 5 | `new --db=drizzle` uses the adapter's default provider (postgres). Run `db:init --force --provider=sqlite` afterwards, or add a flag. | On request |
| Other targets for `creds:sync` | Phase 5 | `--target=vercel` only. Netlify, Fly and GitHub Actions secrets need one small mapping each. | On request |
| Registration entry for custom generators | Phase 6 | The spec lists a registration entry next to `tools/generators/<name>/`. wee discovers generators by directory scan instead, so there is nothing to register and nothing to drift; `g --help` shows a generic `Custom generator: <path>` description because reading the module would run app code at help time. | Decision; revisit on request |
| Runtime import from `next-wee` in custom generators | Phase 6 | The scaffold imports types only and inlines its case helpers. Sharing `kebabCase`, `plural` and the `create` helper at runtime needs a runtime export map in `package.json` and a stable API for those helpers. | On request |
| `stats` for `tools/` | Phase 6 | `stats` counts the primitives under `src/`; custom generators and tasks are not a row. | On request |
| Jobs queue backend | Post-phase 6 | Inngest was removed: it is not a conventional queue, so `g job` writes a plain validated function registered in `jobs/index.ts` with no client, route or dev server. A queue (or scheduler) integration should consume that registry. | When a queue is picked |
| Custom generator args in `g <name> --help` | Phase 6 | The parent command forwards raw args and the child parses them, so the parent's usage shows only the global flags. Listing the generator's args would need the child to answer a `--help` probe. | On request |
| Adapter provider-name table | Review 0.3.0 | `KIT_DIALECT`, `PRISMA_PROVIDER`, `LOCK_PROVIDER` and `PRISMA_AUTH_PROVIDER` map the same three providers. One table is cleaner but touches every adapter test for no behaviour change. | Next adapter change |
| `runTool` in place of `runBin` plus a manual throw | Review 0.3.0 | Every caller checks the exit code by hand. The change touches all `quality` and `db` commands; it shipped separately from the bug fixes to keep the diff small. | Next operations change |
| Split `creds.ts`, `db.ts` and `new.ts` | Review 0.3.0 | Each is over 300 lines. Moving Vercel sync, git enroll, `db:init` and workspace registration to their own modules is a pure move. | Next change to each file |
| Prisma rollback as a capability flag | Review 0.3.0 | Prisma `rollback` throws `rollback-manual`. A `canRollback` flag on `DbAdapter` would let `db:rollback` fail before it reads the journal. | On request |
| `new` through `defineWeeCommand` | Review 0.3.0 | `new` runs without a target app, and `defineWeeCommand` builds a context. Needs a `needsContext: false` option. | With the next `new` change |
| POSIX paths in manifests on Windows | Review 0.3.0 | `creds` paths are POSIX now. Manifest paths still use the platform separator, so a manifest written on Windows does not match on macOS or Linux. No Windows CI runner. | When CI gets a Windows runner |
| `wee doctor` | Review 0.3.0 | One command that checks Node version, package manager, config, adapter packages and pending migrations. | On request |
| Shell completions | Review 0.3.0 | citty has no completion output; needs a generator over the command map, including custom generators and tasks. | On request |
| `destroy --list` | Review 0.3.0 | Lists the manifests under `.app/manifests/` so a user can see what `destroy` can reverse. | On request |
| `wee diff` and `wee upgrade` | Review 0.3.0 | Compares generated files with the current templates and applies the changes where the file has no drift. | On request |
| `db:create`, `db:drop` and `db:migrate:redo` | Review 0.3.0 | `db:prepare` and `db:reset` cover create and drop together; separate commands match Rails. | On request |
| `g seed` and `g factory` | Review 0.3.0 | Seeds are hand-written in `src/db/seeds/`. A factory per model would feed seeds and tests. | On request |
| `AddIndexToX` and `AddReferenceToX` migrations | Review 0.3.0 | `g migration` knows `AddXToY`, `RemoveXFromY` and custom only. | On request |
| `g migration` regenerates the validator, service and form | Review 0.3.0 | After `AddXToY` the validator, service and form miss the new column until the user edits them. | On request |
| `g webhook` and `g cron` | Review 0.3.0 | A signed-body route handler and a scheduled job entry. | On request |
| `routes --json` rows | Review 0.3.0 | `--json` prints the table rows; a structured row with segment kinds as an array would serve tools better. | On request |
| `creds:rotate` | Review 0.3.0 | Re-encrypts every environment file to a new key pair. Today `creds:init --force` makes old files unreadable. | On request |
| Tests for `db:generate`, `db:push`, `db:seed`, `console`, `dev`, `build`, `start` and the `--skip-*` flags | Review 0.3.0 | Covered in part by the acceptance tests; no direct test per command or flag. | Next test pass |

## Known issues

| Issue | Found in | Status |
|---|---|---|
| SQLite refuses `ADD COLUMN ... NOT NULL` without a default. `g migration AddXToY x:string` on sqlite fails at `db:migrate` unless `default=` or `optional` is set. | Phase 1 | Documented in `docs/database-flow.md`. Could fail early in `g migration` with a clear error. |
| MySQL auto-commits DDL, so a failing `<tag>.down.sql` leaves the schema half reverted. | Phase 1 | Documented. No fix planned; MySQL limit. |
| drizzle-kit `generate` exits 0 on error and breaks with an absolute `--out` when snapshots exist. | Phase 1 | Worked around: relative paths, journal diff as the success check. Watch on drizzle-kit upgrades. |
| drizzle-kit `migrate` exits 1 with no message when a migration file has no SQL. | Phase 1 | Worked around: `db:migrate` checks every file first and fails with `migration-empty`. |
| `db:rollback` matches applied rows by `created_at`, which drizzle sets to the journal `when`. A hand-edited journal breaks the match. | Phase 1 | Documented. `db:status` shows the mismatch as `pending`. |
| Human-mode output of `db:migrate` follows drizzle-kit's spinner line without a newline. | Phase 1 | Cosmetic. Row output is suppressed unless `--json`. |
| `test/db.test.ts` symlinks wee's `node_modules` into the scratch app, so the generated app resolves drizzle from wee's tree, not from a real install. | Phase 1 | Acceptable until a fixture with its own install exists. |
| `destroy form` leaves `app/<plural>/actions.ts` in place (it only imports it), and `destroy action` removes the file the form imports. | Phase 2 | By design: each manifest owns its own files. `destroy action` could warn when a form still imports it. |
| Injected blocks in `actions.ts` carry their own `import` lines mid-file. ESM hoists them, but Biome's `organizeImports` assist flags the order. | Phase 2 | `wee lint` runs `biome lint`, which skips assists. `biome check` on a generated app reports it. Hoisting imports into the header would need a merge step in `inject`. |
| `g resource` records `@playwright/test` through the package manager without a version pin, like `db:init` does for Drizzle. A registry with a minimum release age picks the newest allowed version. | Phase 3 | By design; pin by hand when needed. |
| `runner --json` has no effect: the preload inherits stdio and prints with `util.inspect`. | Phase 3 | Documented in `docs/resource-flow.md`. |
| Generated `.test.tsx` files need JSX enabled in the app's Vitest config (`jsx: "react-jsx"` in `tsconfig.json`, or an `oxc`/`esbuild` jsx setting). | Phase 2 | Documented in `docs/routes-ui-flow.md`. `wee new` writes a `tsconfig.json` and `vitest.config.ts` that cover it; apps that adopt wee later set it by hand. |
| Injected back relations in a `.prisma` model file are not aligned like `prisma format` output. | Phase 4 | Cosmetic. `prisma format` rewrites them; the hash then drifts and `destroy` needs `--force`. |
| The `.env.example` block `mail` belongs to the first `g email` manifest. Destroying that run removes the block while other emails remain. | Phase 4 | By design: one owner per block. Run `g email` again to restore it. |
| `test/operations.test.ts` writes its scratch app under `.scratch/` inside this repo (gitignored). Turbopack refuses a `node_modules` symlink that points outside the workspace root, so the app must sit under the lockfile. | Phase 5 | Acceptable until a fixture with its own install exists. |
| Extension discovery in a multi-app monorepo needs `--app`: `quietContext()` swallows `ambiguous-target`, so `wee g --help` and `wee <task>` list nothing until the target is named. | Phase 6 | By design: discovery must not prompt. |
