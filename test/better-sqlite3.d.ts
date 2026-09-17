/** Minimal surface used by the integration suite. The package ships no types. */
declare module "better-sqlite3" {
  interface Statement {
    all(): Array<{ name: string }>
  }
  class Database {
    constructor(file: string)
    prepare(sql: string): Statement
    close(): void
  }
  export default Database
}
