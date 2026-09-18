# Database flow

How `db:init`, `g model`, `g migration` and the `db:*` commands fit together, for Drizzle first and Prisma at the end. One document for the whole flow; the code files carry only short headers.

## Files in the target app

`db:init --adapter=drizzle --provider=<postgres|sqlite|mysql>` writes `drizzle.config.ts`, `src/db/client.ts`, `src/db/schema/index.ts`, `src/db/seed.ts` and `src/db/seeds/README.md`. It records `db: { adapter, provider, schemaDir, migrationsDir }` in `.app/config.json`, adds `db:*` scripts to `package.json`, injects `DATABASE_URL` into `.env.example` and installs `drizzle-orm`, the driver, `zod`, `server-only` and `drizzle-kit` (plus `tsx` when the package manager is not bun). `--skip-install` writes the files only.

## Guard

Every `db:*` command except `db:init`, and every model generator, calls `assertDbReady` first. It fails with `db-not-initialised` when `.app/config.json` has no `db` section, and with `db-not-ready` when the section exists but `drizzle.config.ts`, the schema directory or `drizzle-orm` in `package.json` is missing. Nothing runs against the database before that check passes.

## Adopting an existing setup

When `drizzle.config.{ts,mts,js,mjs}` already exists, `db:init` adopts it. `adopt.ts` reads `dialect`, `schema` and `out` from the file with regular expressions (the file is never executed). `schema` must be a directory or a directory glob; the recorded `schemaDir` and `migrationsDir` are relative to the source dir, so a root-level `./drizzle` becomes `../drizzle`. Init then writes only what is missing: config, scripts, client, schema barrel, seed runner. Existing files are never touched and packages already in `package.json` are not reinstalled. A `--provider` that contradicts the config dialect fails with `provider-mismatch`. The first `g model` after adoption produces a migration that covers the adopted tables too, because drizzle-kit has no earlier snapshot.

## Generators

`g model Post title:string body:text:optional` parses attributes with `src/lib/attributes.ts`, then asks the adapter for four groups of changes: the model file plus an `export *` block in `schema/index.ts`, the Zod validator plus its Vitest test, the CRUD service, and the `create_posts` migration. `--skip-migration` drops the last group.

`g migration AddSlugToPosts slug:string` and `RemoveSlugFromPosts slug:string` edit the existing model file with `model-edit.ts` and write a migration. Remove needs the full column definition because the down migration re-adds the column. Any other name writes a custom migration with an empty up file.

`g validator Post` and `g service Post` accept attributes or reuse the ones recorded in `.app/manifests/model-post.json`.

## How a migration is generated

drizzle-kit owns the up SQL, the snapshot and `meta/_journal.json`. To keep generators pure, `migrations.ts` copies the schema directory and the migrations `meta` directory into a scratch directory under `.app/`, applies the pending schema changes to the copy, runs `drizzle-kit generate` there and turns the new files into `FileChange`s. The scratch directory is removed afterwards. This is why `--dry-run` can show the migration without touching the real directories and why `destroy` can reverse it.

The down SQL is written by wee to `<tag>.down.sql`, split into statements with `--> statement-breakpoint`. Create-table drops the table (and Postgres enum types), add-columns drops the columns (SQLite first drops their indexes), remove-columns re-adds them with their indexes, custom is a comment.

## Running commands

`db:generate`, `db:migrate`, `db:push` and `db:studio` call `drizzle-kit <cmd> --config drizzle.config.ts` after loading `.env.local` and `.env` from the target. `db:migrate` refuses when a migration file has no SQL, because drizzle-kit exits 1 without a message in that case. `db:push` runs only when `APP_ENV` is `local` or `preview`.

`db:status`, `db:rollback`, `db:prepare` and `db:reset` need raw SQL, which `driver.ts` runs through the app's own driver package. Applied migrations are matched to journal entries by `created_at`, which drizzle sets to the journal `when`. `db:rollback --step=n` runs the last n applied down files inside a transaction each and deletes their rows. `db:prepare` creates the database when missing, migrates, and seeds only when the migrations table was absent. `db:reset` drops the database, then runs prepare; it refuses when `APP_ENV` is `production`.

`db:seed` runs `src/db/seed.ts` with `bun` or `tsx`. Each file in `src/db/seeds/` exports `seed(db)` and an optional `table` that `db:seed:replant` truncates first.

## Known limits (Drizzle)

SQLite refuses `ADD COLUMN ... NOT NULL` without a default, so an add migration for a required column without `default=` fails at `db:migrate`; give it a default or mark it optional. MySQL auto-commits DDL, so a failed down file can leave the schema half reverted. Only the SQLite driver path runs in CI.

## Prisma

`db:init --adapter=prisma` writes `prisma.config.ts`, `src/db/schema/schema.prisma` (datasource and generator, client output `src/db/generated/`), `src/db/client.ts`, `src/db/seed.ts` and `src/db/seeds/README.md`. The schema is a folder of `.prisma` files, one per model, so `g model` and `destroy` work file by file. Init installs `@prisma/client`, the driver adapter for the provider, the driver, `zod` and `server-only`, plus `prisma` as a dev dependency. It does not adopt an existing Prisma setup.

`g model` writes `src/db/schema/<plural>.prisma`. A `references` attribute adds the relation field to the new model and injects the back relation (`comments Comment[]`) into the referenced model file. When the referenced model is pending in the same run, as with the four auth models, the inject targets the pending file. `applyChanges` then updates the hash of the created file to its final content, so `destroy` sees no drift.

Prisma owns the up SQL. `emitMigration` copies the schema folder twice into a scratch directory under `.app/`, applies the pending schema changes to one copy and runs `prisma migrate diff --script` between them. The reverse diff becomes `down.sql` next to `migration.sql`. `db:generate` diffs the migration history against the schema folder instead. `db:migrate` runs `prisma migrate deploy` and then `prisma generate`.

`db:rollback` does not run. Prisma has no down migrations and `migrate resolve --rolled-back` accepts failed migrations only. The command fails with `rollback-manual` and prints the three steps per migration: run `down.sql` with `prisma db execute`, delete the row from `_prisma_migrations`, remove the folder (or `destroy` the generator that wrote it). `db:status`, `db:prepare` and `db:reset` use the same driver code as Drizzle; `db:push` runs `prisma db push --accept-data-loss` and is local/preview only.

`console` and `runner` expose `db` (the Prisma client) and `services`. The `schema` scope is undefined on Prisma. `--sandbox` rolls back only what runs through `db`; services import the pooled client.
