import { defineConfig } from "tsdown"

// One ESM bundle plus the console/runner preload, which runs inside the
// target app and must stay a separate file. The shebang in src/cli.ts is
// preserved by the bundler.
export default defineConfig({
  entry: { cli: "src/cli.ts", "runtime/preload": "src/runtime/preload.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: false,
  fixedExtension: false,
})
