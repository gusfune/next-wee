/** Scope the preload hands to the console, the runner and tasks. */
type Module = Record<string, unknown>

interface Scope {
  db: unknown
  schema: Module | undefined
  services: Record<string, Module>
  auth: Module | undefined
}

/** What a `tools/tasks/<name>.ts` task receives: the scope plus its raw args. */
interface TaskContext extends Scope {
  args: string[]
}

export type { Module, Scope, TaskContext }
