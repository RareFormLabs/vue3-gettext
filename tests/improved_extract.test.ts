import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { cwd } from "process";
import { execSync, spawnSync } from "child_process";
import { describe, it, expect } from "vitest";

describe("Improved Extractor Options Tests", () => {
  type WithTempDirTest = (tmpDir: string) => Promise<any>;

  const withTempDir = async (testFunc: WithTempDirTest) => {
    let tmpDir;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-improved-extract-"));
      await testFunc(tmpDir);
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }
  };

  it("should support addLocation: 'file'", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', addLocation: 'file' } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Hello')`);

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      const potContent = (await readFile(join(tmpDir, "srctest", "lang", "messages.pot"))).toString();
      expect(potContent).toContain("#: srctest/test.js\n");
      expect(potContent).not.toContain("#: srctest/test.js:1");
    });
  });

  it("should support addLocation: 'never'", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', addLocation: 'never' } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Hello')`);

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      const potContent = (await readFile(join(tmpDir, "srctest", "lang", "messages.pot"))).toString();
      expect(potContent).not.toContain("#:");
    });
  });

  it("should support autoFill: true", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      // We only test with 'en' locale for auto-filling
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', locales: ['en'], autoFill: ['en'] } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Auto me')`);

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      // Check en.po (flat: true default means path/en.po)
      const poContent = (await readFile(join(tmpDir, "srctest", "lang", "en.po"))).toString();
      expect(poContent).toContain('msgid "Auto me"\nmsgstr "Auto me"');
    });
  });

  it("should not auto-fill if locale is not in autoFill array", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', locales: ['en', 'fr'], autoFill: ['en'] } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Hello')`);

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      const frPo = (await readFile(join(tmpDir, "srctest", "lang", "fr.po"))).toString();
      expect(frPo).toContain('msgid "Hello"\nmsgstr ""');
    });
  });

  it("should parse Plural-Forms header with spaces correctly", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', locales: ['en'], autoFill: ['en'], flat: true } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$ngettext('One', 'Many', 2)`);

      const poPath = join(tmpDir, "srctest", "lang", "en.po");
      await writeFile(
        poPath,
        `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals = 3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"

msgid "One"
msgid_plural "Many"
msgstr[0] ""
msgstr[1] ""
msgstr[2] ""
`,
      );

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      const poContent = (await readFile(poPath)).toString();
      expect(poContent).toContain('msgstr[0] "One"');
      expect(poContent).toContain('msgstr[1] "Many"');
      expect(poContent).toContain('msgstr[2] "Many"');
    });
  });

  it("should exit non-zero and stop after msgmerge fails on duplicate msgid entries", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default {
          input: { path: './srctest', include: ['*.js'] },
          output: { path: './srctest/lang', locales: ['en', 'fr'] }
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Hello')`);
      await writeFile(
        join(tmpDir, "srctest", "lang", "en.po"),
        `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "Hello"
msgstr "Hello"

msgid "Hello"
msgstr "Bonjour"
`,
      );

      const result = spawnSync("npx", ["tsx", "./scripts/gettext_extract.ts"], {
        cwd: tmpDir,
        encoding: "utf-8",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("msgmerge");
      expect(result.stderr).toContain("Command failed");
      expect(result.stdout).not.toContain("Merged");
      expect(result.stdout).not.toContain("Auto-filled");
      expect(result.stdout).not.toContain("Created");
      expect(result.stdout).not.toContain("fr.po");
    });
  });

  it("should exit zero for a normal extraction run", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default {
          input: { path: './srctest', include: ['*.js'] },
          output: { path: './srctest/lang', locales: ['en'] }
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Hello')`);

      const result = spawnSync("npx", ["tsx", "./scripts/gettext_extract.ts"], {
        cwd: tmpDir,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("Command failed");
      expect(result.stdout).toContain("Created");
    });
  });
});
