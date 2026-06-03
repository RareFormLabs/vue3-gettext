import { defineConfig } from "rolldown";

export default defineConfig({
  platform: "node",
  input: ["./scripts/gettext_extract.ts", "./scripts/gettext_compile.ts"],
  output: [{ dir: "dist", format: "es" }],
});
