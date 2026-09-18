# Roadmap

Work we postponed on purpose, and issues we found and did not fix in the phase that found them. PLAN.md says what each phase ships; this file says what each phase left behind and why. Add an entry when you defer something. Remove it when it ships.

## Postponed

| Item | Deferred in | Why | Target |
|---|---|---|---|
| Postgres and MySQL driver tests in CI | Phase 1 | CI has no database service yet. `driver.ts` for both providers is written but only the SQLite path runs in `test/db.test.ts`. | Phase 5 (`wee ci` brings services) |
| `installPackages` test | Phase 1 | Needs network or a registry mock. `db:init --skip-install` covers the file side. | Phase 5 |
| `db:console` and `db:studio` tests | Phase 1 | Both spawn interactive processes. Manual check only. | When a PTY harness exists |
| Seed runner, `console` and `runner` in a monorepo with pnpm or yarn | Phase 1 | `tsx` is installed per app; `runScript` is only verified in the single-repo fixture. | Phase 5 (`wee ci` on the resource app) |
| `g migration` for renames and type changes | Phase 1 | Only `AddXToY`, `RemoveXFromY` and custom. Rename needs a different model edit and drizzle-kit prompts on ambiguity. | On request |
| Composite indexes and `references` with `onDelete` other than restrict | Phase 1 | Attribute grammar has one column per index. Decision table fixes restrict. | On request |
| Adoption of a Drizzle config that uses a `schema` array, a single schema file or a computed value | Phase 1 | `adopt.ts` reads string literals only and needs a schema directory for the barrel. Fails with `drizzle-config-unsupported` and names the fix. | On request |
| Adoption of a client that does not live at `src/db/client.ts` | Phase 1 | Generated services and the `console` preload import `src/db/client.ts`. Adoption creates that file when missing; an app with a client elsewhere gets two clients until the user points one at the other. Needs a `clientPath` config field. | On request |
| Manifest args for `--force` regeneration of validator and service | Phase 1 | A `--force` run writes `modify` changes; `destroy` restores the previous file, which is the older generated version. Acceptable for now. | Phase 6 |
| Intercepting (`(.)`) and parallel (`@slot`) route segments | Phase 2 | `parseSegment` accepts static parts, `(group)` and `[param]` forms only. Fails with `invalid-segment`. | On request |
| `g form` and `g resource` segment choice | Phase 2 | The form always binds to `app/<plural>/actions.ts` and lives in `components/<plural>/`; `g resource` mounts at `/<plural>`. A `--segment` flag would cover nested resources such as `posts/[id]/comments`. | On request |
| Running the generated e2e spec | Phase 3 | `g resource` writes `e2e/<plural>.spec.ts` and installs `@playwright/test`, but nothing runs it: no Playwright config, no browser, no dev server in CI. The acceptance test checks the spec is emitted and the app builds. | Phase 5 (`test:e2e`) |
| Redirect after create | Phase 3 | `createX` returns a success state and the form stays on `/posts/new`. Rails redirects to the show page. Needs `redirect()` in the action and a form that tolerates it. | On request |
| `<Nav />` in the root layout | Phase 3 | `app/layout.tsx` is JSX; marker comments are `//` lines, so `g resource` cannot inject into it. It writes `components/nav.tsx` and prints a note. `new` (Phase 5) will render `<Nav />` from the start. | Phase 5 (`new`) |
| `console --sandbox` on Postgres and MySQL | Phase 3 | The session runs inside `db.transaction` with the transaction handle as `db`, but generated services import the pooled client, so `services.posts.createPost()` commits. SQLite runs BEGIN/ROLLBACK on the single connection and covers services too. | On request. Phase 4 kept the limit; on Prisma `--sandbox` covers `db` only on every provider. |
| Defaults and overrides for generator output | Phase 3 | Every generator hard-codes its choices: page params, list pagination (20 per page), the form's input types, the nav label, the e2e sample values, the boundary files. An app should be able to set defaults once (in `.app/config.json` or `CONVENTIONS.md`) and override them per run with flags, e.g. `g page posts --params=id:uuid`, `g resource Post --per-page=50`, or a config block that turns `loading.tsx` off everywhere. Needs a `defaults` section in the config schema and one resolution order: flag, then app config, then built-in. | Phase 6 (with custom generators) |
| `routes` rendering mode for route handlers with `generateStaticParams` | Phase 3 | Dynamic routes in `prerender-manifest.json` are reported as `static`; the fallback mode is not shown. | On request |
| `robots.ts` and per-segment sitemaps | Phase 2 | `g metadata --sitemap` writes one app-wide `app/sitemap.ts`; a second segment needs `--force`. | On request |
| `g env` options: optional variables, non-string types | Phase 2 | Every variable is `z.string()` required. | On request |
| Removing one variable or one action from a multi-item run | Phase 2 | One manifest per run; `destroy` reverses the whole run. Split runs to keep them separate. | Phase 6 |
| shadcn/ui as an integrated part of the generators | Phase 2 | `g component`, `g form`, `g page` and `g provider` emit plain HTML elements. When the app has `components.json`, they should import shadcn primitives (`Button`, `Input`, `Field`, `Card`) from `components/ui/`, run `shadcn add` for the ones that are missing, and `g provider Theme` should wrap `next-themes`. Needs a UI adapter next to `DbAdapter` so the plain-HTML output stays the default. | Phase 6 (with custom generators) |
| Adoption of an existing Prisma setup | Phase 4 | `db:init --adapter=prisma` writes its own `prisma.config.ts` and schema folder and fails with `file-exists` when they exist. Drizzle adoption reads string literals from the config; Prisma would need the same for `schema` and `migrations.path`. | On request |
| `db:generate` on Prisma with Postgres or MySQL | Phase 4 | `prisma migrate diff --from-migrations` needs a shadow database for these providers. SQLite runs without one. | Phase 5 (`wee ci` brings services) |
| Two `references` to the same model on Prisma | Phase 4 | Prisma needs named relations when a model points at another model twice. The generator writes unnamed relations and `prisma validate` reports the clash. | On request |
| `json` attributes on Prisma | Phase 4 | The validator emits `z.unknown()`, and Prisma create input wants `InputJsonValue`, so the generated service may not typecheck for a model with a `json` attribute. The suite has no Prisma model with `json`. | On request |
| `schema` scope in `console` on Prisma | Phase 4 | Prisma has no schema module; the scope is `undefined`. `db` and `services` work. | On request |
| Validation of the auth provider id | Phase 4 | `g auth:provider Foo` writes `foo` and `typecheck` reports it through `satisfies`. A list of Better Auth ids would catch it at generation time and go stale with upgrades. | On request |
| `mail:preview` test | Phase 4 | Spawns the React Email dev server. Only the `emails-missing` path runs in the suite. | When a PTY harness exists |
| Sign-up page and sign-out | Phase 4 | The sign-in form toggles to sign-up inline and there is no sign-out control. A `g auth` option for separate pages and a `<SignOut />` component would complete the flow. | On request |

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
| Injected blocks in `actions.ts` carry their own `import` lines mid-file. ESM hoists them, but a strict linter may flag the order. | Phase 2 | Cosmetic. Hoisting imports into the header would need a merge step in `inject`. |
| `g resource` records `@playwright/test` through the package manager without a version pin, like `db:init` does for Drizzle. A registry with a minimum release age picks the newest allowed version. | Phase 3 | By design; pin by hand when needed. |
| `runner --json` has no effect: the preload inherits stdio and prints with `util.inspect`. | Phase 3 | Documented in `docs/resource-flow.md`. |
| Generated `.test.tsx` files need JSX enabled in the app's Vitest config (`jsx: "react-jsx"` in `tsconfig.json`, or an `oxc`/`esbuild` jsx setting). | Phase 2 | Documented in `docs/routes-ui-flow.md`. `g page` could scaffold a Vitest config in Phase 5. |
| Injected back relations in a `.prisma` model file are not aligned like `prisma format` output. | Phase 4 | Cosmetic. `prisma format` rewrites them; the hash then drifts and `destroy` needs `--force`. |
| The `.env.example` blocks `jobs` and `mail` belong to the first `g job` or `g email` manifest. Destroying that run removes the block while other jobs or emails remain. | Phase 4 | By design: one owner per block. Run `g job` again to restore it. |
