/**
 * Public types for app-defined extensions. `tools/generators/<name>/index.ts`
 * exports a `GeneratorDef`; `tools/tasks/<name>.ts` takes a `TaskContext`.
 * Types only: the CLI runs the extensions, so nothing here executes.
 */
export type { ArgsDef, ParsedArgs } from "citty"
export type { FileChange } from "./core/changes.js"
export type { Context } from "./core/context.js"
export type { GeneratorDef } from "./core/generator.js"
export type { Scope, TaskContext } from "./runtime/types.js"
