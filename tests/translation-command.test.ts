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

  it("does not mix a shell model pair with a base URL from the local env file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-layered-env-"));
    const languageDir = path.join(tempDir, "language");
    const configPath = path.join(tempDir, "gettext.config.mjs");
    const previous = {
      provider: process.env.VUE_GETTEXT_PROVIDER,
      model: process.env.VUE_GETTEXT_MODEL,
      baseUrl: process.env.VUE_GETTEXT_BASE_URL,
    };
    await mkdir(languageDir, { recursive: true });
    await writeFile(
      configPath,
      `export default { output: { path: ${JSON.stringify(languageDir)}, locales: ["fr"] } };\n`,
    );
    await writeFile(path.join(languageDir, "fr.po"), 'msgid ""\nmsgstr ""\n"Language: fr\\n"\n');
    await writeFile(
      path.join(tempDir, ".env.gettext"),
      "VUE_GETTEXT_PROVIDER=openai\nVUE_GETTEXT_MODEL=gpt-test\nVUE_GETTEXT_BASE_URL=https://local.example/v1\n",
    );
    process.env.VUE_GETTEXT_PROVIDER = "anthropic";
    process.env.VUE_GETTEXT_MODEL = "claude-test";
    delete process.env.VUE_GETTEXT_BASE_URL;
    let selected: { provider: string; id: string; baseUrl?: string } | undefined;

    try {
      await runTranslationCommand(
        { config: configPath, dryRun: true },
        {
          createTranslator: async ({ selection }) => {
            selected = selection;
            return { translate: async () => [] };
          },
        },
      );
      expect(selected).toMatchObject({ provider: "anthropic", id: "claude-test" });
      expect(selected?.baseUrl).toBeUndefined();
    } finally {
      if (previous.provider === undefined) delete process.env.VUE_GETTEXT_PROVIDER;
      else process.env.VUE_GETTEXT_PROVIDER = previous.provider;
      if (previous.model === undefined) delete process.env.VUE_GETTEXT_MODEL;
      else process.env.VUE_GETTEXT_MODEL = previous.model;
      if (previous.baseUrl === undefined) delete process.env.VUE_GETTEXT_BASE_URL;
      else process.env.VUE_GETTEXT_BASE_URL = previous.baseUrl;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates every target PO path before creating a translator or writing files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-prevalidate-"));
    const languageDir = path.join(tempDir, "language");
    const configPath = path.join(tempDir, "gettext.config.mjs");
    const frenchPath = path.join(languageDir, "fr.po");
    const original = `msgid ""\nmsgstr ""\n"Language: fr\\n"\n\nmsgid "Hello"\nmsgstr ""\n`;
    await mkdir(languageDir, { recursive: true });
    await writeFile(
      configPath,
      `export default {
        output: { path: ${JSON.stringify(languageDir)}, locales: ["fr", "de"] },
        translate: { model: { provider: "faux", id: "test-model" } },
      };\n`,
    );
    await writeFile(frenchPath, original);
    const createTranslator = vi.fn(async () => ({ translate: async () => [] }));

    try {
      await expect(runTranslationCommand({ config: configPath }, { createTranslator })).rejects.toThrow(
        "PO file not found for locale de",
      );
      expect(createTranslator).not.toHaveBeenCalled();
      expect(await readFile(frenchPath, "utf8")).toBe(original);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates provider setup failures", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-provider-failure-"));
    const languageDir = path.join(tempDir, "language");
    const configPath = path.join(tempDir, "gettext.config.mjs");
    await mkdir(languageDir, { recursive: true });
    await writeFile(path.join(languageDir, "en.po"), 'msgid ""\nmsgstr ""\n"Language: en\\n"\n');
    await writeFile(
      configPath,
      `export default {
        output: { path: ${JSON.stringify(languageDir)}, locales: ["en"] },
        translate: { model: { provider: "faux", id: "test-model" } },
      };\n`,
    );

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
