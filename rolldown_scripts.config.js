import { defineConfig } from "rolldown";

export default defineConfig({
  platform: "node",
  // Keep pi-ai external so its provider package can resolve its own deferred
  // OAuth modules at runtime (for example openai-codex.js).
  external: [/^@earendil-works\/pi-ai(?:\/|$)/],
  input: [
    "./scripts/gettext_extract.ts",
    "./scripts/gettext_compile.ts",
    "./scripts/gettext_translate.ts",
    "./scripts/gettext_auth.ts",
  ],
  output: [{ dir: "dist", format: "es" }],
});
