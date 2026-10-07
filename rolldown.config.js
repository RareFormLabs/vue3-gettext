import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";
import pkg from "./package.json" with { type: "json" };

// Externalize peer and runtime dependencies so consuming applications provide
// their own copy (most importantly Vue - bundling it causes duplicate Vue
// instances and broken reactivity in consumers).
const external = [...Object.keys(pkg.peerDependencies ?? {}), ...Object.keys(pkg.dependencies ?? {})];

export default defineConfig([
  {
    input: "./src/index.ts",
    external,
    plugins: [dts()],
    output: [{ dir: "dist", format: "es" }],
  },
  {
    // Node-only entry, kept separate so it never ends up in the browser bundle.
    input: { vite: "./scripts/vite.ts" },
    platform: "node",
    external,
    plugins: [dts({ tsconfig: "./scripts/tsconfig.json" })],
    output: [{ dir: "dist", format: "es" }],
  },
  {
    // Node-only entry (depends on pofile -> fs), kept separate so it never ends
    // up in the browser bundle.
    input: { extract: "./src/extract/index.ts" },
    platform: "node",
    external,
    plugins: [dts()],
    output: [{ dir: "dist", format: "es" }],
  },
]);
