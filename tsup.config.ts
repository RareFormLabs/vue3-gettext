import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    clean: true,
    dts: true,
    format: ["esm"],
  },
  {
    entry: ["scripts/gettext_extract.ts"],
    clean: true,
    external: ["typescript"],
    format: ["esm"],
  },
  {
    entry: ["scripts/gettext_compile.ts"],
    clean: true,
    format: ["esm"],
  },
  {
    entry: ["scripts/gettext_translate.ts"],
    clean: false,
    format: ["esm"],
  },
  {
    entry: ["scripts/gettext_openai_login.ts"],
    clean: false,
    format: ["esm"],
  },
]);
