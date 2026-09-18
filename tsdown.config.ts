import { defineConfig } from "tsdown"

// One ESM bundle plus two runtimes that run inside the target app and must
// stay separate files: the console/runner preload and the ci config reader. The shebang in src/cli.ts is
// preserved by the bundler.
export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "runtime/preload": "src/runtime/preload.ts",
    "runtime/ci-config": "src/runtime/ci-config.ts",
  },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: false,
  fixedExtension: false,
})
