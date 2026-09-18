import { defineConfig } from "tsdown"

// One ESM bundle, a types-only entry for extensions, and three runtimes that
// run inside the target app and must stay separate files: the console/runner
// preload, the ci config reader and the custom generator host. The shebang in
// src/cli.ts is preserved by the bundler.
export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
    "runtime/preload": "src/runtime/preload.ts",
    "runtime/ci-config": "src/runtime/ci-config.ts",
    "runtime/generator": "src/runtime/generator.ts",
  },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: true,
  fixedExtension: false,
})
