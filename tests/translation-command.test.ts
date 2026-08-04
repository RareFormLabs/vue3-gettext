import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runTranslationCommand } from "../scripts/translation-command.js";

describe("translation command", () => {
  it("validates a dry run without changing the PO file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-translation-command-"));
    const languageDir = path.join(tempDir, "language");
    const configPath = path.join(tempDir, "gettext.config.mjs");
    const poPath = path.join(languageDir, "fr.po");
    await writeFile(
      configPath,
      `export default {
        output: { path: ${JSON.stringify(languageDir)}, locales: ["fr"] },
        translate: { model: { provider: "faux", id: "test-model" } },
      };\n`,
    );
    await mkdir(languageDir, { recursive: true });
    const original = `msgid ""\nmsgstr ""\n"Language: fr\\n"\n\nmsgid "Hello"\nmsgstr ""\n`;
    await writeFile(poPath, original);
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await runTranslationCommand(
        { config: configPath, dryRun: true },
        {
          createTranslator: async () => ({
            translate: async ({ entries }) => entries.map((entry) => ({ key: entry.key, msgstr: ["Bonjour"] })),
          }),
        },
      );
      expect(await readFile(poPath, "utf8")).toBe(original);
    } finally {
      consoleSpy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates provider setup failures", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-provider-failure-"));
    const configPath = path.join(tempDir, "gettext.config.mjs");
    await writeFile(configPath, `export default { translate: { model: { provider: "faux", id: "test-model" } } };\n`);

    try {
      await expect(
        runTranslationCommand(
          { config: configPath },
          { createTranslator: async () => Promise.reject(new Error("Provider unavailable")) },
        ),
      ).rejects.toThrow("Provider unavailable");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("exits nonzero when command configuration fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-command-failure-"));
    const configPath = path.join(tempDir, "gettext.config.mjs");
    await writeFile(configPath, "export default {};\n");

    try {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", path.resolve("scripts/gettext_translate.ts"), "--config", configPath],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, VUE_GETTEXT_PROVIDER: "", VUE_GETTEXT_MODEL: "" },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No translation provider and model are configured");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
