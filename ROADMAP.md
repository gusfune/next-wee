# Roadmap

Work we postponed on purpose, and issues we found and did not fix in the phase that found them. PLAN.md says what each phase ships; this file says what each phase left behind and why. Add an entry when you defer something. Remove it when it ships.

## Postponed

| Item | Deferred in | Why | Target |
|---|---|---|---|
| Prisma `DbAdapter` | Phase 1 | Drizzle first; the `DbAdapter` interface is in place and `db:init --adapter=prisma` fails with `adapter-unavailable`. Prisma has no down migrations, so `db:rollback` will print the manual procedure. | Phase 4 |
| Postgres and MySQL driver tests in CI | Phase 1 | CI has no database service yet. `driver.ts` for both providers is written but only the SQLite path runs in `test/db.test.ts`. | Phase 5 (`wee ci` brings services) |
| `installPackages` test | Phase 1 | Needs network or a registry mock. `db:init --skip-install` covers the file side. | Phase 5 |
| `db:console` and `db:studio` tests | Phase 1 | Both spawn interactive processes. Manual check only. | When a PTY harness exists |
| Seed runner in a monorepo with pnpm or yarn | Phase 1 | `tsx` is installed per app; not verified in `fixtures/pnpm-mono`. | Phase 3 (resource app) |
| `g migration` for renames and type changes | Phase 1 | Only `AddXToY`, `RemoveXFromY` and custom. Rename needs a different model edit and drizzle-kit prompts on ambiguity. | Phase 4 or on request |
| Composite indexes and `references` with `onDelete` other than restrict | Phase 1 | Attribute grammar has one column per index. Decision table fixes restrict. | On request |
| Adoption of a Drizzle config that uses a `schema` array, a single schema file or a computed value | Phase 1 | `adopt.ts` reads string literals only and needs a schema directory for the barrel. Fails with `drizzle-config-unsupported` and names the fix. | On request |
| Adoption of a client that does not live at `src/db/client.ts` | Phase 1 | Generated services import `../db/client`. Adoption creates that file when missing; an app with a client elsewhere gets two clients until the user points one at the other. Needs a `clientPath` config field. | Phase 3 |
| Manifest args for `--force` regeneration of validator and service | Phase 1 | A `--force` run writes `modify` changes; `destroy` restores the previous file, which is the older generated version. Acceptable for now. | Phase 6 |
| Intercepting (`(.)`) and parallel (`@slot`) route segments | Phase 2 | `parseSegment` accepts static parts, `(group)` and `[param]` forms only. Fails with `invalid-segment`. | On request |
| `g form` segment choice | Phase 2 | The form always binds to `app/<plural>/actions.ts` and lives in `components/<plural>/`. A `--segment` flag would cover nested resources. | Phase 3 (`g resource`) |
| `robots.ts` and per-segment sitemaps | Phase 2 | `g metadata --sitemap` writes one app-wide `app/sitemap.ts`; a second segment needs `--force`. | On request |
| `g env` options: optional variables, non-string types | Phase 2 | Every variable is `z.string()` required. | On request |
| Removing one variable or one action from a multi-item run | Phase 2 | One manifest per run; `destroy` reverses the whole run. Split runs to keep them separate. | Phase 6 |
| shadcn/ui as an integrated part of the generators | Phase 2 | `g component`, `g form`, `g page` and `g provider` emit plain HTML elements. When the app has `components.json`, they should import shadcn primitives (`Button`, `Input`, `Field`, `Card`) from `components/ui/`, run `shadcn add` for the ones that are missing, and `g provider Theme` should wrap `next-themes`. Needs a UI adapter next to `DbAdapter` so the plain-HTML output stays the default. | Phase 4 (adapters) |

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
| Generated `.test.tsx` files need JSX enabled in the app's Vitest config (`jsx: "react-jsx"` in `tsconfig.json`, or an `oxc`/`esbuild` jsx setting). | Phase 2 | Documented in `docs/routes-ui-flow.md`. `g page` could scaffold a Vitest config in Phase 5. |
