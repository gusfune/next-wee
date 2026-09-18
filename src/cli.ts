#!/usr/bin/env node
/**
 * Entry point. Built-in commands load lazily. Tasks from the target's
 * `tools/tasks/` join the map when the first argument is not a built-in,
 * so `wee reports:nightly` runs `tools/tasks/reports-nightly.ts`.
 */
import { defineCommand, runMain } from "citty"
import pkg from "../package.json" with { type: "json" }
import { builtInCommands } from "./commands/builtins.js"
import { taskLoaders } from "./lib/custom.js"

const main = defineCommand({
  meta: {
    name: "wee",
    version: pkg.version,
    description: "Rails-grade command tooling for Next.js App Router apps",
  },
  subCommands: {
    ...(await taskLoaders(process.argv[2], builtInCommands)),
    ...builtInCommands,
  },
})

await runMain(main)
