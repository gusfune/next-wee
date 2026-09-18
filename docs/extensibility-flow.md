# Extensibility flow

How an app adds its own generators and tasks, how the CLI finds them, and
how a custom generator gets `--dry-run`, `--json` and `destroy` for free.
Phase 6.

## Discovery

`src/lib/custom.ts` scans the target before citty parses the command line.
`quietContext()` reads the global flags from `process.argv` and builds the
Context with `json: true`, so an ambiguous monorepo target or a missing
`package.json` returns nothing to discover instead of a prompt or an error.

Custom generators live in `tools/generators/<name>/index.ts`; the directory
name is the command name. `g()` in `src/commands/g/index.ts` is an async
factory that merges `customGeneratorLoaders()` under the built-in map, so a
built-in name wins. `wee g --help` lists each custom generator as
`Custom generator: tools/generators/<name>/index.ts`.

Tasks live in `tools/tasks/<name>.ts`. `taskLoaders(first, builtIns)` in
`src/cli.ts` scans only when the first argv token is not a built-in
command. The file name is kebab-case; `reports:nightly` maps to
`reports-nightly.ts`, and the token as typed is added as an alias so both
spellings run the same file.

## `g generator <Name>`

`src/commands/g/generator.ts` writes `tools/generators/<name>/index.ts` and
`templates/<name>.ts.tpl` under the manifest `generator-<name>`. A built-in
name fails with `generator-reserved`.

The scaffold depends on `next-wee` for types only
(`import type { GeneratorDef } from "next-wee"`), so it runs before the
package is a runtime dependency; the case helpers it needs are inlined. It
exports `generator` with `name`, `description`, `args`, `manifestName` and
`run`, the same contract as the built-in generators. `run` reads the
template, replaces `__Name__` (PascalCase) and `__name__` (camelCase), and
returns one `create` change for `src/<plural>/<kebab>.ts`.

## Running a custom generator

`customGeneratorCommand` in `src/commands/custom.ts` is a `defineWeeCommand`
without args of its own: the raw tokens after the command name go to the
generator untouched. It runs `dist/runtime/generator.js` (or
`src/runtime/generator.ts` from source) inside the target with `runScript`,
so the module resolves the app's own imports, and passes one JSON argument
`{ ctx, rawArgs }`.

The runtime imports the module, checks the `generator` export, parses
`rawArgs` with `{ ...generator.args, ...globalArgs }`, calls
`manifestName` and `run`, and prints one line
`__wee_generator__:{ name, args, changes }`. Other stdout lines are
forwarded to stderr so `--json` stays clean. A non-zero exit or a missing
marker fails with `generator-failed` and the child's exit code.

The parent validates the changes with `fileChangeSchema` (zod) and hands
them to `recordGeneratorRun`, the tail of `runGenerator`: apply the changes
(or describe them under `--dry-run`), write the manifest
`<generator>-<name>` with the args, and return the rows. `destroy <name>
<Name>` reads that manifest like any other, so no CLI change is needed.

## `g task <name>` and `wee <name>`

`src/commands/g/task.ts` writes `tools/tasks/<kebab>.ts` under the manifest
`task-<name>`. A built-in command name fails with `task-reserved`. The file
exports `task(ctx: TaskContext)`, where `TaskContext` is the console scope
(`db`, `schema`, `services`, `auth`) plus `args`, the tokens after the task
name minus the global flags.

`taskCommand` runs the console preload in runner mode:
`--mode runner --file <task> -- <args>`. `runPreload` takes `requireDb`;
tasks pass `false`, so an app without a database runs them with `db`
undefined and no `--schema`, `--provider` or `--adapter` flags. The preload
calls `module.task ?? module.default`; a `false` return or a throw exits 1.

## Public types

`src/index.ts` re-exports `ArgsDef`, `ParsedArgs`, `FileChange`, `Context`,
`GeneratorDef`, `Scope` and `TaskContext` as types only. tsdown emits
`dist/index.d.ts` and `package.json` points `types` and `exports["."]` at
it. Until the package is published, an app resolves the types through a
tsconfig `paths` entry that points at `src/index.ts` (see
`test/extensibility.test.ts`).

## Tests

`test/extensibility.test.ts` copies `fixtures/single-repo`, scaffolds a
`widget` generator, runs it with `--dry-run` and `--json` in-process and
through the CLI child, typechecks the app against the public types, runs a
task with both spellings and with its own args, checks the exit code of a
task that returns `false`, and destroys every run.
