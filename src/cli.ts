#!/usr/bin/env node
/** Entry point. Subcommands load lazily so `wee about` does not import generators. */
import { defineCommand, runMain } from "citty"
import pkg from "../package.json" with { type: "json" }

const main = defineCommand({
  meta: {
    name: "wee",
    version: pkg.version,
    description: "Rails-grade command tooling for Next.js App Router apps",
  },
  subCommands: {
    about: () => import("./commands/about.js").then((m) => m.about),
    init: () => import("./commands/init.js").then((m) => m.init),
    destroy: () => import("./commands/destroy.js").then((m) => m.destroy),
    g: () => import("./commands/g/index.js").then((m) => m.g),
    generate: () => import("./commands/g/index.js").then((m) => m.g),
    "db:init": () => import("./commands/db.js").then((m) => m.dbInit),
    "db:generate": () => import("./commands/db.js").then((m) => m.dbGenerate),
    "db:migrate": () => import("./commands/db.js").then((m) => m.dbMigrate),
    "db:rollback": () => import("./commands/db.js").then((m) => m.dbRollback),
    "db:status": () => import("./commands/db.js").then((m) => m.dbStatus),
    "db:push": () => import("./commands/db.js").then((m) => m.dbPush),
    "db:seed": () => import("./commands/db.js").then((m) => m.dbSeed),
    "db:seed:replant": () =>
      import("./commands/db.js").then((m) => m.dbSeedReplant),
    "db:prepare": () => import("./commands/db.js").then((m) => m.dbPrepare),
    "db:reset": () => import("./commands/db.js").then((m) => m.dbReset),
    "db:studio": () => import("./commands/db.js").then((m) => m.dbStudio),
    "db:console": () => import("./commands/db.js").then((m) => m.dbConsole),
    routes: () => import("./commands/routes.js").then((m) => m.routes),
    console: () =>
      import("./commands/console.js").then((m) => m.consoleCommand),
    runner: () => import("./commands/console.js").then((m) => m.runner),
    "mail:preview": () =>
      import("./commands/mail.js").then((m) => m.mailPreview),
    new: () => import("./commands/new.js").then((m) => m.newApp),
    dev: () => import("./commands/ops.js").then((m) => m.dev),
    build: () => import("./commands/ops.js").then((m) => m.build),
    start: () => import("./commands/ops.js").then((m) => m.start),
    lint: () => import("./commands/quality.js").then((m) => m.lint),
    typecheck: () => import("./commands/quality.js").then((m) => m.typecheck),
    test: () => import("./commands/quality.js").then((m) => m.test),
    "test:e2e": () => import("./commands/quality.js").then((m) => m.testE2e),
    ci: () => import("./commands/ci.js").then((m) => m.ci),
    stats: () => import("./commands/stats.js").then((m) => m.stats),
    notes: () => import("./commands/notes.js").then((m) => m.notes),
    "creds:init": () => import("./commands/creds.js").then((m) => m.credsInit),
    "creds:edit": () => import("./commands/creds.js").then((m) => m.credsEdit),
    "creds:show": () => import("./commands/creds.js").then((m) => m.credsShow),
    "creds:diff": () => import("./commands/creds.js").then((m) => m.credsDiff),
    "creds:fetch": () =>
      import("./commands/creds.js").then((m) => m.credsFetch),
    "creds:sync": () => import("./commands/creds.js").then((m) => m.credsSync),
  },
})

await runMain(main)
