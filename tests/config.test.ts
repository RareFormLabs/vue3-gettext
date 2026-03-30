import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { cwd } from "process";
import { execSync } from "child_process";
import { loadConfig } from "../scripts/config.js";

describe("config format tests", () => {
  type WithTempDirTest = (tmpDir: string) => Promise<any>;

  const withTempDir = async (testFunc: WithTempDirTest) => {
    let tmpDir;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-"));
      await testFunc(tmpDir);
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }
  };

  const testConfigWithExtract = async (tmpDir: string, config: string, configFileName: string, isModule: boolean) => {
    const packageJson = {
      name: "test",
      version: "0.0.1",
      type: isModule ? "module" : "commonjs",
    };
    for (const d of ["src", "scripts", "node_modules"]) {
      await symlink(join(cwd(), d), join(tmpDir, d));
    }
    await writeFile(join(tmpDir, "package.json"), JSON.stringify(packageJson));
    await writeFile(join(tmpDir, configFileName), config);
    await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
    await writeFile(
      join(tmpDir, "srctest", "example.js"),
      `
const { $gettext } = useGettext();
$gettext('Translate me');
`,
    );
    execSync(`sh -c 'cd ${tmpDir}; tsx ./scripts/gettext_extract.ts'`);
    const appEnPo = (await readFile(join(tmpDir, "srctest", "lang", "en.po"))).toString();
    const appEnPoLines = appEnPo.trim().split("\n");
    expect(appEnPoLines).toContain('msgid "Translate me"');
    expect(appEnPoLines[appEnPoLines.length - 1]).toEqual('msgstr "Translate me"');
    const appFrPo = (await readFile(join(tmpDir, "srctest", "lang", "fr.po"))).toString();
    const appFrPoLines = appFrPo.trim().split("\n");
    expect(appFrPoLines).toContain('msgid "Translate me"');
    expect(appFrPoLines[appFrPoLines.length - 1]).toEqual('msgstr ""');
  };

  it("load a commonjs format", async () => {
    await withTempDir(
      async (tmpDir) =>
        await testConfigWithExtract(
          tmpDir,
          `
module.exports = {
  input: {
    path: './srctest',
  },
  output: {
    path: './srctest/lang',
    locales: ['en', 'fr'],
  },
};`,
          "gettext.config.js",
          false,
        ),
    );
  });
  it("load an ESM format", async () => {
    await withTempDir(
      async (tmpDir) =>
        await testConfigWithExtract(
          tmpDir,
          `
export default {
  input: {
    path: './srctest',
  },
  output: {
    path: './srctest/lang',
    locales: ['en', 'fr'],
  },
};`,
          "gettext.config.js",
          true,
        ),
    );
  });

  it("output without locations", async () => {
    await withTempDir(async (tmpDir) => {
      await testConfigWithExtract(
        tmpDir,
        `
export default {
  input: {
    path: './srctest',
  },
  output: {
    path: './srctest/lang',
    locales: ['en', 'fr'],
    locations: false,
  },
};`,
        "gettext.config.js",
        true,
      );
      const appEnPo = (await readFile(join(tmpDir, "srctest", "lang", "en.po"))).toString();
      expect(appEnPo).not.toContain("#:");
    });
  });

  it("loads translate config defaults and overrides", async () => {
    await withTempDir(async (tmpDir) => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test",
          version: "0.0.1",
          type: "module",
        }),
      );
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default {
          output: {
            path: './srctest/lang',
            locales: ['fr'],
          },
          translate: {
            model: 'gpt-4.1',
            locales: ['fr', 'de'],
            openai: {
              apiKeyEnvVar: 'CUSTOM_OPENAI_KEY',
            },
          },
        };`,
      );

      const previousCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const config = await loadConfig();
        expect(config.translate.provider).toBe("openai");
        expect(config.translate.model).toBe("gpt-4.1");
        expect(config.translate.includeTranslated).toBe(false);
        expect(config.translate.locales).toEqual(["fr", "de"]);
        expect(config.translate.openai?.apiKeyEnvVar).toBe("CUSTOM_OPENAI_KEY");
      } finally {
        process.chdir(previousCwd);
      }
    });
  });
});
