// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, vi, afterEach } from "vitest";
import { build, createLogger, createServer, type Rollup, type ViteDevServer } from "vite";
import gettext from "../scripts/vite.js";
import { compileTranslations } from "../scripts/compile.js";
import { loadConfig } from "../scripts/config.js";

const po = (lang: string, entries: Record<string, string>) =>
  [
    'msgid ""',
    'msgstr ""',
    `"Language: ${lang}\\n"`,
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    "",
    ...Object.entries(entries).flatMap(([id, str]) => [`msgid "${id}"`, `msgstr "${str}"`, ""]),
  ].join("\n");

describe("vite plugin", () => {
  let tmpDir: string | undefined;
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await server?.close();
    server = undefined;
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  const setupProject = async (output: Record<string, unknown> = {}) => {
    tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-vite-"));
    const langDir = join(tmpDir, "lang");
    const configPath = join(tmpDir, "gettext.config.mjs");
    await writeFile(
      configPath,
      `export default ${JSON.stringify({ output: { path: langDir, locales: ["fr"], ...output } })};`,
    );
    await mkdir(langDir);
    await writeFile(join(langDir, "fr.po"), po("fr", { Hello: "Bonjour" }));
    await writeFile(
      join(tmpDir, "main.js"),
      `import translations from "./lang/translations.json";\nconsole.log(translations.fr.Hello);\n`,
    );
    return { root: tmpDir, langDir, configPath, jsonPath: join(langDir, "translations.json") };
  };

  it("compiles .po files before a build so the json can be imported", async () => {
    const { root, configPath, jsonPath } = await setupProject();

    const result = (await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [gettext({ config: configPath })],
      build: { write: false, rollupOptions: { input: join(root, "main.js") } },
    })) as Rollup.RollupOutput;

    expect(JSON.parse(await readFile(jsonPath, "utf-8"))).toEqual({ fr: { Hello: "Bonjour" } });
    expect(result.output[0].type === "chunk" && result.output[0].code).toContain("Bonjour");
  });

  it("respects splitJson and prettyJson", async () => {
    const { root, langDir, configPath } = await setupProject({ splitJson: true, prettyJson: true });

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [gettext({ config: configPath })],
      build: { write: false, rollupOptions: { input: join(langDir, "fr.json") } },
    });

    expect(await readFile(join(langDir, "fr.json"), "utf-8")).toBe(`{\n  "fr": {\n    "Hello": "Bonjour"\n  }\n}\n`);
  });

  it("fails a build when initial PO compilation fails", async () => {
    const { root, langDir, configPath } = await setupProject();
    await writeFile(join(langDir, "fr.po"), 'msgid ""\nmsgstr ""\n\n<<<<<<< HEAD\n');

    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [gettext({ config: configPath })],
        build: { write: false, rollupOptions: { input: join(root, "main.js") } },
      }),
    ).rejects.toThrow("No Language headers found!");
  });

  it("fails Vitest startup when initial PO compilation fails", async () => {
    // Vitest sets this before starting its Vite server (and it is already set while these tests run).
    vi.stubEnv("VITEST", "true");
    const { root, langDir, configPath } = await setupProject();
    await writeFile(join(langDir, "fr.po"), 'msgid ""\nmsgstr ""\n\n<<<<<<< HEAD\n');

    await expect(
      createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [gettext({ config: configPath })],
        server: { middlewareMode: true, ws: false },
      }).then((s) => (server = s)),
    ).rejects.toThrow("No Language headers found!");
  });

  it.each(["change", "add"])("recovers from initial PO compilation failure on %s", async (event) => {
    // Simulate the interactive dev server rather than Vitest.
    vi.stubEnv("VITEST", "");
    const { root, langDir, configPath, jsonPath } = await setupProject();
    const appRoot = join(root, "app");
    await mkdir(appRoot);
    const poPath = join(langDir, "fr.po");
    if (event === "add") {
      await rm(poPath);
    } else {
      await writeFile(poPath, 'msgid ""\nmsgstr ""\n\n<<<<<<< HEAD\n');
    }
    const logger = createLogger("silent");
    const errorSpy = vi.spyOn(logger, "error");

    server = await createServer({
      // Existing PO paths outside the root must still be registered after a failure.
      root: event === "change" ? appRoot : root,
      configFile: false,
      customLogger: logger,
      plugins: [gettext({ config: configPath })],
      server: { middlewareMode: true, ws: false },
    });
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("vue3-gettext: failed to compile translations"), {
        timestamp: true,
      }),
    );
    // Directories under the root are reported by their real path (e.g. /private/var/... for macOS temp dirs).
    const langDirPaths = [langDir, await realpath(langDir)];
    await vi.waitFor(() =>
      expect(Object.keys(server!.watcher.getWatched()).some((dir) => langDirPaths.includes(dir))).toBe(true),
    );

    await writeFile(poPath, po("fr", { Hello: "Salut" }));
    await vi.waitFor(async () =>
      expect(JSON.parse(await readFile(jsonPath, "utf-8"))).toEqual({ fr: { Hello: "Salut" } }),
    );
  });

  it("reports an error in the dev server when a .po file is deleted", async () => {
    const { root, langDir, configPath, jsonPath } = await setupProject();
    const logger = createLogger("silent");
    const errorSpy = vi.spyOn(logger, "error");

    server = await createServer({
      root,
      configFile: false,
      customLogger: logger,
      plugins: [gettext({ config: configPath })],
      server: { middlewareMode: true, ws: false, watch: null },
    });
    await vi.waitFor(async () => expect(JSON.parse(await readFile(jsonPath, "utf-8")).fr.Hello).toBe("Bonjour"));

    const poPath = join(langDir, "fr.po");
    await rm(poPath);
    server.watcher.emit("unlink", poPath);
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("vue3-gettext: failed to compile translations"), {
        timestamp: true,
      }),
    );
  });

  it("recompiles in the dev server when a .po file changes, and survives a broken one", async () => {
    const { root, langDir, configPath, jsonPath } = await setupProject();
    const logger = createLogger("silent");
    const errorSpy = vi.spyOn(logger, "error");

    server = await createServer({
      root,
      configFile: false,
      customLogger: logger,
      plugins: [gettext({ config: configPath })],
      server: { middlewareMode: true, ws: false, watch: null },
    });
    await vi.waitFor(async () => expect(JSON.parse(await readFile(jsonPath, "utf-8")).fr.Hello).toBe("Bonjour"));

    const poPath = join(langDir, "fr.po");
    await writeFile(poPath, po("fr", { Hello: "Salut" }));
    server.watcher.emit("change", poPath);
    await vi.waitFor(async () => expect(JSON.parse(await readFile(jsonPath, "utf-8")).fr.Hello).toBe("Salut"));

    // e.g. a .po file left with merge conflict markers
    await writeFile(poPath, 'msgid ""\nmsgstr ""\n\n<<<<<<< HEAD\n');
    server.watcher.emit("change", poPath);
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("vue3-gettext"), expect.anything()),
    );
    expect(JSON.parse(await readFile(jsonPath, "utf-8")).fr.Hello).toBe("Salut");
  });
});

describe("compileTranslations", () => {
  it.each([
    ["a combined", { jsonPath: "generated/nested/translations.json" }, "generated/nested/translations.json"],
    ["a split", { jsonPath: "generated/nested", splitJson: true }, "generated/nested/fr.json"],
  ])("creates missing directories for %s json output", async (_, output, expectedFile) => {
    const tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-compile-"));
    try {
      await writeFile(join(tmpDir, "fr.po"), po("fr", { Hello: "Bonjour" }));
      const configPath = join(tmpDir, "gettext.config.mjs");
      await writeFile(
        configPath,
        `export default ${JSON.stringify({ output: { path: tmpDir, locales: ["fr"], ...output } })};`,
      );

      await compileTranslations(await loadConfig({ config: configPath }));

      expect(JSON.parse(await readFile(join(tmpDir, expectedFile), "utf-8"))).toEqual({ fr: { Hello: "Bonjour" } });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("doesn't rewrite json files whose content is unchanged", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-compile-"));
    try {
      await writeFile(join(tmpDir, "fr.po"), po("fr", { Hello: "Bonjour" }));
      const configPath = join(tmpDir, "gettext.config.mjs");
      await writeFile(configPath, `export default ${JSON.stringify({ output: { path: tmpDir, locales: ["fr"] } })};`);
      const config = await loadConfig({ config: configPath });

      const first = await compileTranslations(config);
      const mtime = (await stat(config.output.jsonPath)).mtimeMs;
      const second = await compileTranslations(config);

      expect(first.files).toEqual([{ path: config.output.jsonPath, changed: true }]);
      expect(second.files).toEqual([{ path: config.output.jsonPath, changed: false }]);
      expect((await stat(config.output.jsonPath)).mtimeMs).toBe(mtime);
      // written via a temp file that is renamed into place, none left behind
      expect((await readdir(tmpDir)).sort()).toEqual(["fr.po", "gettext.config.mjs", "translations.json"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
