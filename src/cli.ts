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
  },
})

await runMain(main)
