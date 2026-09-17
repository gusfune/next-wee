import { defineConfig } from "tsdown"

// One ESM bundle. The shebang in src/cli.ts is preserved by the bundler.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: false,
  fixedExtension: false,
})
