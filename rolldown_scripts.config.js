import { defineConfig } from "rolldown";

export default defineConfig({
  platform: "node",
  input: [
    "./scripts/gettext_extract.ts",
    "./scripts/gettext_compile.ts",
    "./scripts/gettext_translate.ts",
    "./scripts/gettext_openai_login.ts",
  ],
  output: [{ dir: "dist", format: "es" }],
});
