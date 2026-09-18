/**
 * The built-in top-level commands. Each one loads lazily so `wee about`
 * does not import the generators. `g task` reads the keys to refuse a task
 * that would shadow a built-in.
 */
import type { SubCommandsDef } from "citty"

const builtInCommands = {
  about: () => import("./about.js").then((m) => m.about),
  init: () => import("./init.js").then((m) => m.init),
  destroy: () => import("./destroy.js").then((m) => m.destroy),
  g: () => import("./g/index.js").then((m) => m.g()),
  generate: () => import("./g/index.js").then((m) => m.g()),
  "db:init": () => import("./db.js").then((m) => m.dbInit),
  "db:generate": () => import("./db.js").then((m) => m.dbGenerate),
  "db:migrate": () => import("./db.js").then((m) => m.dbMigrate),
  "db:rollback": () => import("./db.js").then((m) => m.dbRollback),
  "db:status": () => import("./db.js").then((m) => m.dbStatus),
  "db:push": () => import("./db.js").then((m) => m.dbPush),
  "db:seed": () => import("./db.js").then((m) => m.dbSeed),
  "db:seed:replant": () => import("./db.js").then((m) => m.dbSeedReplant),
  "db:prepare": () => import("./db.js").then((m) => m.dbPrepare),
  "db:reset": () => import("./db.js").then((m) => m.dbReset),
  "db:studio": () => import("./db.js").then((m) => m.dbStudio),
  "db:console": () => import("./db.js").then((m) => m.dbConsole),
  routes: () => import("./routes.js").then((m) => m.routes),
  console: () => import("./console.js").then((m) => m.consoleCommand),
  runner: () => import("./console.js").then((m) => m.runner),
  "mail:preview": () => import("./mail.js").then((m) => m.mailPreview),
  new: () => import("./new.js").then((m) => m.newApp),
  dev: () => import("./ops.js").then((m) => m.dev),
  build: () => import("./ops.js").then((m) => m.build),
  start: () => import("./ops.js").then((m) => m.start),
  lint: () => import("./quality.js").then((m) => m.lint),
  typecheck: () => import("./quality.js").then((m) => m.typecheck),
  test: () => import("./quality.js").then((m) => m.test),
  "test:e2e": () => import("./quality.js").then((m) => m.testE2e),
  ci: () => import("./ci.js").then((m) => m.ci),
  stats: () => import("./stats.js").then((m) => m.stats),
  notes: () => import("./notes.js").then((m) => m.notes),
  "creds:init": () => import("./creds.js").then((m) => m.credsInit),
  "creds:edit": () => import("./creds.js").then((m) => m.credsEdit),
  "creds:show": () => import("./creds.js").then((m) => m.credsShow),
  "creds:diff": () => import("./creds.js").then((m) => m.credsDiff),
  "creds:fetch": () => import("./creds.js").then((m) => m.credsFetch),
  "creds:sync": () => import("./creds.js").then((m) => m.credsSync),
} satisfies SubCommandsDef

export { builtInCommands }
