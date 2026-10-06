import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { describe, it, expect } from "vitest";
import { serializeTranslations } from "../scripts/compile.js";
import type { Translations } from "../src/typeDefs.js";

describe("serializeTranslations", () => {
  const translations: Translations = {
    fr: {
      Zebra: "Zèbre",
      Apple: "Pomme",
      "%{n} car": ["%{n} voiture", "%{n} voitures"],
      Open: { verb: "Ouvrir", adjective: "Ouvert" },
    },
    en: { Hello: "Hello" },
  };

  it("keeps the minified output by default", () => {
    expect(serializeTranslations(translations)).toBe(JSON.stringify(translations));
  });

  it("sorts keys and puts each entry on its own line when pretty", () => {
    expect(serializeTranslations(translations, true)).toBe(
      `{
  "en": {
    "Hello": "Hello"
  },
  "fr": {
    "%{n} car": [
      "%{n} voiture",
      "%{n} voitures"
    ],
    "Apple": "Pomme",
    "Open": {
      "adjective": "Ouvert",
      "verb": "Ouvrir"
    },
    "Zebra": "Zèbre"
  }
}
`,
    );
  });

  it("round-trips to the same data when pretty", () => {
    expect(JSON.parse(serializeTranslations(translations, true))).toEqual(translations);
  });
});

describe("vue-gettext-compile with prettyJson", () => {
  const po = (lang: string, entries: Record<string, string>) =>
    [
      'msgid ""',
      'msgstr ""',
      `"Language: ${lang}\\n"`,
      '"Content-Type: text/plain; charset=UTF-8\\n"',
      "",
      ...Object.entries(entries).flatMap(([id, str]) => [`msgid "${id}"`, `msgstr "${str}"`, ""]),
    ].join("\n");

  const runCompile = async (output: Record<string, unknown>, assertions: (langDir: string) => Promise<void>) => {
    const tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-compile-"));
    try {
      await writeFile(join(tmpDir, "fr.po"), po("fr", { Zebra: "Zèbre", Apple: "Pomme" }));
      await writeFile(join(tmpDir, "de.po"), po("de", { Apple: "Apfel" }));
      const configPath = join(tmpDir, "gettext.config.mjs");
      await writeFile(
        configPath,
        `export default ${JSON.stringify({ output: { path: tmpDir, locales: ["fr", "de"], prettyJson: true, ...output } })};`,
      );
      execFileSync(join("node_modules", ".bin", "tsx"), ["./scripts/gettext_compile.ts", "--config", configPath]);
      await assertions(tmpDir);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  };

  it("writes a pretty combined translations.json", async () => {
    await runCompile({}, async (langDir) => {
      expect(await readFile(join(langDir, "translations.json"), "utf-8")).toBe(
        `{
  "de": {
    "Apple": "Apfel"
  },
  "fr": {
    "Apple": "Pomme",
    "Zebra": "Zèbre"
  }
}
`,
      );
    });
  });

  it("writes a pretty json file per locale with splitJson", async () => {
    await runCompile({ splitJson: true }, async (langDir) => {
      expect(await readFile(join(langDir, "fr.json"), "utf-8")).toBe(
        `{
  "fr": {
    "Apple": "Pomme",
    "Zebra": "Zèbre"
  }
}
`,
      );
      expect(await readFile(join(langDir, "de.json"), "utf-8")).toBe(
        `{
  "de": {
    "Apple": "Apfel"
  }
}
`,
      );
    });
  });
});
